// A COBOL interpreter in the style of IBM OS/VS COBOL on a System/370 mainframe (1970s).
// The program is a job: compile errors look like the compiler's listing ("IKF ERROR, LINE 7: …"),
// run-time failures are ABENDs ("ABEND S0C7 (DATA EXCEPTION) …"), just like the operators saw them.
//
// Reference format: columns 1-6 hold a sequence number (or nothing), column 7 a * for a comment line,
// Area A (columns 8-11) the division, section and paragraph headers and the 01/77 levels,
// Area B (column 12 on) the statements. Everything after column 72 is ignored.
//
// Supported: the four divisions; WORKING-STORAGE with levels 01-49, 77 and 88, PIC/PICTURE with
// 9 S V X A and the editing symbols Z * $ , . + - CR DB B 0 /, VALUE, OCCURS (with INDEXED BY), REDEFINES;
// DISPLAY, ACCEPT, MOVE, ADD, SUBTRACT, MULTIPLY, DIVIDE (GIVING, REMAINDER, ROUNDED, ON SIZE ERROR),
// COMPUTE, IF/ELSE/END-IF, EVALUATE, PERFORM (paragraphs, THRU, TIMES, UNTIL, VARYING, inline),
// GO TO, INITIALIZE, SET, STRING, INSPECT, SEARCH, STOP RUN; files: SELECT … ASSIGN, FD, OPEN, READ … AT END,
// WRITE (… AFTER ADVANCING), CLOSE, on a small simulated disk. A file assigned to PRINTER prints its lines.
// Numbers are exact decimals (no rounding errors), like the mainframe's decimal arithmetic.
import type { RunResult } from "./course";

const MAX_STEPS = 300_000;
const MAX_OUTPUT = 20_000;
const MAX_DIGITS = 18;

class CompileError extends Error {}
class Abend extends Error {}
class StopRun {}
class GoToSignal {
  constructor(public para: number) {}
}

function cerr(line: number, msg: string): never {
  throw new CompileError(`IKF ERROR, LINE ${line}: ${msg}`);
}
function abend(code: string, what: string, line: number, msg: string): never {
  throw new Abend(`ABEND ${code} (${what}) AT LINE ${line}: ${msg}`);
}

// ---------- Exact decimal numbers ----------

type Dec = { n: bigint; s: number }; // the value is n / 10^s
const P10: bigint[] = [];
const pow10 = (k: number): bigint => (P10[k] ??= 10n ** BigInt(k));
const ZERO_DEC: Dec = { n: 0n, s: 0 };
function decOf(text: string): Dec {
  const neg = text.startsWith("-");
  const t = text.replace(/^[+-]/, "");
  const [i, f = ""] = t.split(".");
  return { n: BigInt((i || "0") + f) * (neg ? -1n : 1n), s: f.length };
}
function alignDec(a: Dec, b: Dec): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
}
const addDec = (a: Dec, b: Dec): Dec => {
  const [x, y, s] = alignDec(a, b);
  return { n: x + y, s };
};
const subDec = (a: Dec, b: Dec): Dec => {
  const [x, y, s] = alignDec(a, b);
  return { n: x - y, s };
};
const mulDec = (a: Dec, b: Dec): Dec => ({ n: a.n * b.n, s: a.s + b.s });
function divDec(a: Dec, b: Dec, line: number): Dec {
  if (b.n === 0n) abend("S0CB", "DIVIDE EXCEPTION", line, "DIVISION BY ZERO.");
  const s = 20; // intermediate results keep 20 decimals
  const k = s + b.s - a.s;
  const num = k >= 0 ? a.n * pow10(k) : a.n / pow10(-k);
  return { n: num / b.n, s };
}
function cmpDec(a: Dec, b: Dec): number {
  const [x, y] = alignDec(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}
// To s decimals: cut off, or round half away from zero
function rescale(d: Dec, s: number, round = false): Dec {
  if (s >= d.s) return { n: d.n * pow10(s - d.s), s };
  const p = pow10(d.s - s);
  let q = d.n / p;
  if (round) {
    const r = d.n % p;
    const abs = r < 0n ? -r : r;
    if (abs * 2n >= p) q += d.n < 0n ? -1n : 1n;
  }
  return { n: q, s };
}
function powDec(a: Dec, b: Dec, line: number): Dec {
  const bi = rescale(b, 0);
  if (cmpDec(bi, b) === 0 && bi.n >= 0n && bi.n <= 64n) {
    let r: Dec = { n: 1n, s: 0 };
    for (let k = 0n; k < bi.n; k++) {
      r = mulDec(r, a);
      if (r.s > 40) r = rescale(r, 20);
    }
    return r;
  }
  const x = Math.pow(decNumber(a), decNumber(b));
  if (!Number.isFinite(x)) abend("S0CA", "OVERFLOW", line, "THE RESULT OF ** IS TOO BIG.");
  return decOf(x.toFixed(12));
}
const decNumber = (d: Dec) => Number(d.n) / Math.pow(10, d.s);
function decText(d: Dec): string {
  const neg = d.n < 0n;
  let digits = (neg ? -d.n : d.n).toString();
  if (d.s > 0) {
    digits = digits.padStart(d.s + 1, "0");
    digits = digits.slice(0, -d.s) + "." + digits.slice(-d.s);
    digits = digits.replace(/\.?0+$/, "");
  }
  return (neg ? "-" : "") + digits;
}

// ---------- Source lines and tokens ----------

type Tok = { t: "word" | "num" | "str" | "pic" | "op" | "period"; v: string; line: number; areaA: boolean; col: number };

const ID_PARAGRAPHS = new Set(["AUTHOR", "INSTALLATION", "DATE-WRITTEN", "DATE-COMPILED", "SECURITY", "REMARKS"]);

function tokenize(source: string): Tok[] {
  const toks: Tok[] = [];
  const lines = source.replace(/\r/g, "").split("\n");
  let skippingComment = false; // AUTHOR. and friends hold free text
  let inIdDivision = false;
  lines.forEach((raw0, idx) => {
    const lineNo = idx + 1;
    const raw = raw0.replace(/\t/g, "    ");
    if (raw.trim() === "") return;
    const seq = raw.slice(0, 6);
    if (/\S/.test(seq) && !/^[0-9 ]*$/.test(seq)) {
      const first = raw.search(/\S/) + 1;
      cerr(lineNo, `THE CODE STARTS IN COLUMN ${first}, BUT COLUMNS 1-6 ARE FOR THE SEQUENCE NUMBER AND COLUMN 7 FOR * COMMENTS. START IN COLUMN 8 (AREA A) OR 12 (AREA B).`);
    }
    const indicator = raw[6] ?? " ";
    if (indicator === "*" || indicator === "/") return;
    if (indicator !== " " && indicator !== "-") cerr(lineNo, `COLUMN 7 HOLDS '${indicator}'. ONLY * (A COMMENT) OR A SPACE MAY BE THERE.`);
    const content = raw.slice(7, 72);
    const first = content.search(/\S/);
    if (first < 0) return;
    const areaA = first < 4;
    const head = content.trim().toUpperCase();
    if (/^(IDENTIFICATION|ID)\s+DIVISION\b/.test(head)) inIdDivision = true;
    else if (/^\w+\s+DIVISION\b/.test(head)) inIdDivision = false;
    if (inIdDivision) {
      const word = head.split(/[\s.]/)[0];
      if (areaA) skippingComment = ID_PARAGRAPHS.has(word);
      if (skippingComment) return;
    }
    lexLine(content, lineNo, toks);
  });
  return toks;
}

const SIGN_WORDS = new Set(["TO", "BY", "FROM", "VALUE", "VALUES", "GIVING", "INTO", "THAN", "IS", "WHEN", "THRU", "THROUGH", "UNTIL", "DISPLAY", "MOVE", "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "AND", "OR", "NOT", "ALSO", "COMPUTE"]);
const OPS = ["**", ">=", "<=", "<>", "=", ">", "<", "+", "-", "*", "/", "(", ")", ":"];

function lexLine(content: string, line: number, toks: Tok[]) {
  let i = 0;
  let firstOnLine = true;
  const push = (t: Tok["t"], v: string, col: number) => {
    toks.push({ t, v, line, areaA: firstOnLine && col < 4, col: col + 8 });
    firstOnLine = false;
  };
  while (i < content.length) {
    const c = content[i];
    if (c === " " || c === "," || c === ";") {
      i++;
      continue;
    }
    // A picture string: everything up to the next space (a final period ends the entry)
    const last = toks[toks.length - 1];
    const prev = toks[toks.length - 2];
    if (last && last.line === line && last.t === "word" && (last.v === "PIC" || last.v === "PICTURE" || (last.v === "IS" && prev && (prev.v === "PIC" || prev.v === "PICTURE"))) && c !== "I") {
      let j = i;
      while (j < content.length && content[j] !== " ") j++;
      let pic = content.slice(i, j);
      const endsPeriod = pic.endsWith(".") && (j >= content.length || content[j] === " ");
      if (endsPeriod) pic = pic.slice(0, -1);
      push("pic", pic.toUpperCase(), i);
      if (endsPeriod) push("period", ".", j - 1);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let text = "";
      for (;;) {
        if (j >= content.length) cerr(line, `THE TEXT ${c}${text.slice(0, 20)}… HAS NO CLOSING ${c}.`);
        if (content[j] === c) {
          if (content[j + 1] === c) {
            text += c;
            j += 2;
            continue;
          }
          break;
        }
        text += content[j++];
      }
      push("str", text, i);
      i = j + 1;
      continue;
    }
    // Numbers: 42, 21.50, -3, .5 (a sign only directly in front of a digit)
    const rest = content.slice(i);
    const num = rest.match(/^[+-]?(\d+\.\d+|\.\d+|\d+)(?![A-Za-z0-9-]*[A-Za-z])/);
    // A + or - is a sign only where no value comes before it (MOVE -5, X * -2); else it's an operator
    const signOk = !last || (last.t === "op" && last.v !== ")") || (last.t === "word" && SIGN_WORDS.has(last.v));
    if (num && (/[0-9.]/.test(c) || (/[+-]/.test(c) && signOk))) {
      push("num", num[0], i);
      i += num[0].length;
      continue;
    }
    const word = rest.match(/^[A-Za-z0-9]+(?:-+[A-Za-z0-9]+)*/);
    if (word) {
      push("word", word[0].toUpperCase(), i);
      i += word[0].length;
      continue;
    }
    if (c === "." && (i + 1 >= content.length || content[i + 1] === " ")) {
      push("period", ".", i);
      i++;
      continue;
    }
    const op = OPS.find((o) => content.startsWith(o, i));
    if (op) {
      push("op", op, i);
      i += op.length;
      continue;
    }
    cerr(line, `'${c}' DOESN'T BELONG HERE.`);
  }
}

// ---------- Data ----------

type Lit = { k: "num"; d: Dec; text: string } | { k: "str"; s: string } | { k: "fig"; f: "ZERO" | "SPACE" | "HIGH" | "LOW" | "QUOTE" | "ALL"; s?: string };

type Item = {
  name: string;
  level: number;
  line: number;
  parent: Item | null;
  children: Item[];
  pic: string | null;
  cat: "group" | "alnum" | "numeric" | "edited" | "cond";
  digits: number;
  scale: number;
  signed: boolean;
  size: number; // bytes of one occurrence
  occurs: number;
  base: number; // address of the first occurrence
  value: Lit | null;
  condValues: [Lit, Lit | null][];
  redefines: string | null;
  indexNames: string[];
  file?: string; // records in the FILE SECTION: the file they belong to
};
type Select = { name: string; assign: string; line: number };

const FIGURATIVE: Record<string, Lit> = {
  ZERO: { k: "fig", f: "ZERO" },
  ZEROS: { k: "fig", f: "ZERO" },
  ZEROES: { k: "fig", f: "ZERO" },
  SPACE: { k: "fig", f: "SPACE" },
  SPACES: { k: "fig", f: "SPACE" },
  "HIGH-VALUE": { k: "fig", f: "HIGH" },
  "HIGH-VALUES": { k: "fig", f: "HIGH" },
  "LOW-VALUE": { k: "fig", f: "LOW" },
  "LOW-VALUES": { k: "fig", f: "LOW" },
  QUOTE: { k: "fig", f: "QUOTE" },
  QUOTES: { k: "fig", f: "QUOTE" },
};

function expandPic(pic: string, line: number): string {
  let out = pic.replace(/(.)\((\d+)\)/g, (_, ch: string, n: string) => {
    const k = parseInt(n, 10);
    if (k < 1 || k > 200) cerr(line, `PIC ${pic}: THE COUNT IN ( ) MUST BE 1 TO 200.`);
    return ch.repeat(k);
  });
  if (/[()]/.test(out)) cerr(line, `PIC ${pic} IS NOT A VALID PICTURE. A COUNT GOES IN BRACKETS AFTER THE SYMBOL, LIKE 9(5).`);
  return out;
}

// Turn a picture into the item's category and size
function describePic(item: Item, picText: string, line: number) {
  const p = expandPic(picText, line);
  item.pic = p;
  if (/[^9SVXAPZ*$,.+\-CRDB0\/]/.test(p.replace(/CR|DB/g, ""))) cerr(line, `PIC ${picText} HAS A SYMBOL COBOL DOESN'T KNOW.`);
  if (/[XA]/.test(p)) {
    if (/[SVZ*$,.+\-]/.test(p)) cerr(line, `PIC ${picText} MIXES TEXT (X) WITH NUMBER SYMBOLS.`);
    item.cat = "alnum";
    item.size = p.length;
    return;
  }
  if (/^S?[9P]*V?[9P]*$/.test(p) && /9/.test(p)) {
    item.cat = "numeric";
    item.signed = p.startsWith("S");
    const [ip, fp = ""] = p.replace("S", "").split("V");
    item.digits = (ip + fp).replace(/P/g, "").length;
    item.scale = fp.replace(/P/g, "").length;
    item.size = item.digits;
    if (item.digits > MAX_DIGITS) cerr(line, `PIC ${picText} HAS ${item.digits} DIGITS. A NUMBER CAN HAVE AT MOST ${MAX_DIGITS}.`);
    return;
  }
  if (/S/.test(p) || /V.*V/.test(p)) cerr(line, `PIC ${picText} IS NOT A VALID PICTURE.`);
  item.cat = "edited";
  item.size = p.replace("V", "").length;
  const point = p.search(/[.V]/);
  const ip = point < 0 ? p : p.slice(0, point);
  const fp = point < 0 ? "" : p.slice(point + 1);
  const digitPos = (s: string, floatCh: string | null) => {
    let n = (s.match(/[9Z*]/g) ?? []).length;
    if (floatCh) n += Math.max(0, (s.split(floatCh).length - 1) - (s === ip ? 1 : 0));
    return n;
  };
  const fl = floatChar(p);
  item.scale = digitPos(fp, fl);
  item.digits = digitPos(ip, fl) + item.scale;
  if (item.digits === 0) cerr(line, `PIC ${picText} HAS NO DIGIT POSITIONS.`);
}

// $$$9.99 or ---9: a symbol repeated at the front floats to the first digit
function floatChar(p: string): string | null {
  const m = p.match(/^[^9Z*.V]*/)![0];
  for (const ch of ["$", "+", "-"]) if ((m.split(ch).length - 1) >= 2) return ch;
  return null;
}

// The edited text of a number, for a numeric-edited picture
function editNumber(pic: string, value: Dec, digits: number, scale: number): string {
  const neg = value.n < 0n;
  const v = rescale(value, scale);
  let ds = (v.n < 0n ? -v.n : v.n).toString().padStart(digits, "0");
  ds = ds.slice(ds.length - digits); // too many digits: the front ones are lost
  const isZero = /^0*$/.test(ds);
  const fl = floatChar(pic);
  const units: string[] = [];
  for (let i = 0; i < pic.length; i++) {
    if (pic.startsWith("CR", i) || pic.startsWith("DB", i)) {
      units.push(pic.slice(i, i + 2));
      i++;
    } else units.push(pic[i]);
  }
  const pointAt = units.findIndex((u) => u === "." || u === "V");
  const allSuppress = !units.some((u) => u === "9");
  const star = units.includes("*");
  if (isZero && allSuppress) {
    // Nothing to show: Z pictures go blank, * pictures fill with stars
    return units.map((u) => (u === "V" ? "" : star ? (u === "." ? "." : "*".repeat(u.length)) : " ".repeat(u.length))).join("");
  }
  let di = 0;
  let significant = false;
  let floatSeen = false;
  const out: string[] = [];
  const floatSlots: number[] = []; // positions inside the floating run
  units.forEach((u, idx) => {
    const beforePoint = pointAt < 0 || idx < pointAt;
    const fill = star ? "*" : " ";
    if (fl && u === fl && beforePoint) {
      if (!floatSeen) {
        floatSeen = true;
        floatSlots.push(out.length);
        out.push(" ");
        return;
      }
      const d = ds[di++];
      if (d !== "0") significant = true;
      floatSlots.push(out.length);
      out.push(significant ? d : " ");
      return;
    }
    switch (u) {
      case "9": {
        significant = true;
        out.push(ds[di++]);
        return;
      }
      case "Z":
      case "*": {
        const d = ds[di++];
        if (d !== "0" || !beforePoint) significant = true;
        out.push(significant ? d : fill);
        return;
      }
      case ".":
        if (!isZero) significant = true;
        out.push(significant ? "." : fill);
        return;
      case "V":
        if (!isZero) significant = true;
        return;
      case ",":
      case "B":
      case "0":
      case "/": {
        const ch = u === "B" ? " " : u;
        if (fl && !significant && beforePoint && floatSeen) floatSlots.push(out.length);
        out.push(significant ? ch : fill);
        return;
      }
      case "$":
        out.push("$");
        return;
      case "+":
        out.push(neg ? "-" : "+");
        return;
      case "-":
        out.push(neg ? "-" : " ");
        return;
      case "CR":
      case "DB":
        out.push(neg ? u : "  ");
        return;
    }
  });
  if (fl) {
    // The floating symbol goes right in front of the first digit that is shown
    const sym = fl === "$" ? "$" : fl === "+" ? (neg ? "-" : "+") : neg ? "-" : " ";
    const firstDigit = out.findIndex((ch, i) => /[0-9]/.test(ch) && i >= floatSlots[0]);
    const at = firstDigit > 0 ? firstDigit - 1 : floatSlots[floatSlots.length - 1];
    if (at !== undefined && at >= 0) out[at] = sym;
  }
  return out.join("");
}

// ---------- The program ----------

type Expr =
  | { k: "lit"; lit: Lit; line: number }
  | { k: "ref"; ref: RefExpr }
  | { k: "bin"; op: string; a: Expr; b: Expr; line: number }
  | { k: "neg"; e: Expr; line: number };
type RefExpr = { name: string; quals: string[]; subs: Expr[]; refMod: [Expr, Expr | null] | null; line: number };
type Cond =
  | { k: "rel"; a: Expr; op: string; b: Expr; line: number }
  | { k: "class"; a: Expr; cls: string; not: boolean; line: number }
  | { k: "name"; ref: RefExpr }
  | { k: "and" | "or"; a: Cond; b: Cond }
  | { k: "not"; c: Cond };
type Target = { ref: RefExpr; rounded: boolean };
type SizePhrase = { onError: Stmt[] | null; notOnError: Stmt[] | null };
type Stmt =
  | { k: "display"; items: Expr[]; noAdvancing: boolean; line: number }
  | { k: "accept"; ref: RefExpr; from: string | null; line: number }
  | { k: "move"; src: Expr; targets: RefExpr[]; line: number }
  | { k: "arith"; verb: string; operands: Expr[]; to: Target[]; giving: Target[]; remainder: Target | null; byFirst: boolean; size: SizePhrase; line: number }
  | { k: "compute"; targets: Target[]; e: Expr; size: SizePhrase; line: number }
  | { k: "if"; c: Cond; then: Stmt[]; else: Stmt[]; line: number }
  | { k: "evaluate"; subject: Expr | "TRUE" | "FALSE"; whens: { objs: ({ not: boolean; a: Expr; thru: Expr | null } | { cond: Cond } | "ANY")[]; stmts: Stmt[] }[]; other: Stmt[] | null; line: number }
  | { k: "perform"; para: number | null; thru: number | null; body: Stmt[] | null; times: Expr | null; until: Cond | null; testAfter: boolean; varying: { ref: RefExpr; from: Expr; by: Expr; until: Cond }[]; line: number }
  | { k: "goto"; para: number; line: number }
  | { k: "stop"; line: number }
  | { k: "nop"; line: number }
  | { k: "initialize"; refs: RefExpr[]; line: number }
  | { k: "set"; refs: RefExpr[]; mode: "TRUE" | "TO" | "UP" | "DOWN"; value: Expr | null; line: number }
  | { k: "string"; parts: { e: Expr; delim: Expr | "SIZE" }[]; into: RefExpr; pointer: RefExpr | null; line: number }
  | { k: "open"; files: { mode: string; name: string }[]; line: number }
  | { k: "close"; names: string[]; line: number }
  | { k: "read"; file: string; into: RefExpr | null; atEnd: Stmt[] | null; notAtEnd: Stmt[] | null; line: number }
  | { k: "write"; rec: RefExpr; from: Expr | null; lines: Expr | null; page: boolean; before: boolean; line: number }
  | { k: "search"; table: RefExpr; atEnd: Stmt[] | null; whens: { c: Cond; stmts: Stmt[] }[]; line: number }
  | { k: "inspect"; ref: RefExpr; tallying: { counter: RefExpr; what: "ALL" | "LEADING" | "CHARACTERS"; e: Expr | null }[]; replacing: { what: "ALL" | "LEADING" | "FIRST" | "CHARACTERS"; from: Expr | null; to: Expr }[]; line: number };

const VERBS = new Set([
  "DISPLAY", "ACCEPT", "MOVE", "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "COMPUTE", "IF", "EVALUATE", "PERFORM", "GO", "STOP",
  "EXIT", "CONTINUE", "INITIALIZE", "SET", "GOBACK", "STRING", "INSPECT", "SEARCH", "OPEN", "CLOSE", "READ", "WRITE", "UNSTRING",
]);
const TERMINATORS = new Set([
  "ELSE", "END-IF", "WHEN", "END-EVALUATE", "END-PERFORM", "END-ADD", "END-SUBTRACT", "END-MULTIPLY", "END-DIVIDE", "END-COMPUTE",
  "END-STRING", "END-INSPECT", "NOT", "ON", "SIZE", "AT", "END-SEARCH", "END-READ", "END-WRITE",
]);
const RESERVED = new Set([...VERBS, ...TERMINATORS, "TO", "FROM", "BY", "INTO", "GIVING", "REMAINDER", "ROUNDED", "THAN", "IS", "AND", "OR",
  "UNTIL", "VARYING", "TIMES", "THRU", "THROUGH", "OF", "IN", "TRUE", "FALSE", "OTHER", "ALSO", "UPON", "WITH", "NO", "ADVANCING", "DELIMITED",
  "EQUAL", "GREATER", "LESS", "ERROR", "TEST", "BEFORE", "AFTER", "ALL", "LEADING", "FIRST", "CHARACTERS", "REPLACING", "TALLYING", "FOR", "POINTER",
  "UP", "DOWN", "THEN", "RUN", "INPUT", "OUTPUT", "EXTEND", "LINE", "LINES", "PAGE", "RECORD", "NEXT", "NUMERIC", "ALPHABETIC", "POSITIVE", "NEGATIVE", "ANY", "PROCEDURE", "DIVISION", "SECTION", "END", ...Object.keys(FIGURATIVE)]);

type Para = { name: string; stmts: Stmt[]; line: number };

class Parser {
  i = 0;
  paraNames = new Map<string, number>();
  constructor(private toks: Tok[]) {}

  peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  lastLine() {
    return this.toks[Math.min(this.i, this.toks.length - 1)]?.line ?? 1;
  }
  isWord(v: string, o = 0) {
    const t = this.peek(o);
    return !!t && t.t === "word" && t.v === v;
  }
  isOp(v: string, o = 0) {
    const t = this.peek(o);
    return !!t && t.t === "op" && t.v === v;
  }
  eatWord(...vs: string[]) {
    const t = this.peek();
    if (t && t.t === "word" && vs.includes(t.v)) {
      this.i++;
      return t.v;
    }
    return null;
  }
  expectWord(v: string, why: string) {
    if (!this.eatWord(v)) cerr(this.peek()?.line ?? this.lastLine(), `${why} (FOUND ${this.peek() ? `'${this.peek()!.v}'` : "THE END OF THE PROGRAM"}).`);
  }
  expectPeriod(after: string) {
    const t = this.peek();
    if (t?.t === "period") {
      this.i++;
      return;
    }
    const prev = this.toks[this.i - 1];
    cerr(prev?.line ?? this.lastLine(), `A PERIOD IS MISSING AFTER ${after}.`);
  }
  atPeriod() {
    return this.peek()?.t === "period";
  }
  atEnd() {
    return this.i >= this.toks.length;
  }

  // ----- the divisions -----
  selects: Select[] = [];
  program(): { items: Item[]; paras: Para[]; programId: string; selects: Select[] } {
    const first = this.peek();
    if (!first || !(first.t === "word" && (first.v === "IDENTIFICATION" || first.v === "ID")))
      cerr(first?.line ?? 1, "A PROGRAM STARTS WITH IDENTIFICATION DIVISION. (IN AREA A, COLUMN 8).");
    this.divisionHeader("IDENTIFICATION");
    if (!this.isWord("PROGRAM-ID")) cerr(this.peek()?.line ?? this.lastLine(), "PROGRAM-ID. IS MISSING. EVERY PROGRAM NEEDS A NAME: PROGRAM-ID. HELLO.");
    this.i++;
    this.expectPeriod("PROGRAM-ID");
    const nameTok = this.peek();
    if (!nameTok || nameTok.t !== "word") cerr(nameTok?.line ?? this.lastLine(), "THE PROGRAM'S NAME IS MISSING AFTER PROGRAM-ID.");
    this.i++;
    if (this.atPeriod()) this.i++;
    else cerr(nameTok.line, `A PERIOD IS MISSING AFTER THE PROGRAM NAME ${nameTok.v}.`);
    // ENVIRONMENT DIVISION: the files (SELECT … ASSIGN TO …); everything else is skipped
    if (this.isWord("ENVIRONMENT")) {
      this.divisionHeader("ENVIRONMENT");
      while (!this.atEnd() && !(this.isWord("DIVISION", 1) && (this.isWord("DATA") || this.isWord("PROCEDURE")))) {
        if (this.isWord("SELECT")) {
          const line = this.peek()!.line;
          this.i++;
          this.eatWord("OPTIONAL");
          const n = this.peek();
          if (!n || n.t !== "word") cerr(line, "SELECT NEEDS THE FILE'S NAME: SELECT SALES-FILE ASSIGN TO SALES.");
          this.i++;
          this.expectWord("ASSIGN", `SELECT ${n.v} NEEDS ASSIGN TO, LIKE ASSIGN TO SALES`);
          this.eatWord("TO");
          const a = this.peek();
          if (!a || (a.t !== "word" && a.t !== "str")) cerr(line, "ASSIGN TO NEEDS THE NAME OF THE FILE ON THE DISK, OR PRINTER.");
          this.i++;
          if (this.selects.some((x) => x.name === n.v)) cerr(line, `THE FILE ${n.v} IS SELECTED TWICE.`);
          this.selects.push({ name: n.v, assign: a.v.toUpperCase().replace(/^UT-S-|\.DAT$/g, ""), line });
          while (!this.atEnd() && !this.atPeriod()) this.i++; // ORGANIZATION IS LINE SEQUENTIAL and so on
          this.expectPeriod(`SELECT ${n.v}`);
          continue;
        }
        this.i++;
      }
    }
    let items: Item[] = [];
    if (this.isWord("DATA")) {
      this.divisionHeader("DATA");
      items = this.dataDivision();
    }
    if (!this.isWord("PROCEDURE")) {
      const t = this.peek();
      if (!t) cerr(this.lastLine(), "PROCEDURE DIVISION. IS MISSING. THAT'S WHERE THE PROGRAM'S STATEMENTS GO.");
      cerr(t.line, `EXPECTED PROCEDURE DIVISION., FOUND '${t.v}'.${t.t === "word" && VERBS.has(t.v) ? " STATEMENTS ONLY GO INTO THE PROCEDURE DIVISION." : ""}`);
    }
    this.divisionHeader("PROCEDURE");
    const paras = this.procedureDivision();
    return { items, paras, programId: nameTok.v, selects: this.selects };
  }

  divisionHeader(name: string) {
    const t = this.peek()!;
    if (!t.areaA) cerr(t.line, `${name} DIVISION BELONGS IN AREA A: START IT IN COLUMN 8.`);
    this.i++;
    this.expectWord("DIVISION", `${name} MUST BE FOLLOWED BY DIVISION`);
    if (name === "PROCEDURE" && this.eatWord("USING")) while (this.peek()?.t === "word") this.i++;
    this.expectPeriod(`${name} DIVISION`);
  }

  // ----- DATA DIVISION -----
  dataDivision(): Item[] {
    const all: Item[] = [];
    const stack: Item[] = [];
    let inWS = false;
    let inFS = false;
    let fd: string | null = null; // the file whose records come next
    while (!this.atEnd() && !this.isWord("PROCEDURE")) {
      const t = this.peek()!;
      if (t.t === "word" && this.isWord("SECTION", 1)) {
        if (!t.areaA) cerr(t.line, `${t.v} SECTION BELONGS IN AREA A: START IT IN COLUMN 8.`);
        if (t.v === "FILE") {
          if (inWS) cerr(t.line, "THE FILE SECTION COMES BEFORE THE WORKING-STORAGE SECTION.");
          inFS = true;
        } else if (t.v === "WORKING-STORAGE") {
          inWS = true;
          inFS = false;
          fd = null;
        } else cerr(t.line, `THE ${t.v} SECTION ISN'T USED IN THESE LESSONS. USE FILE SECTION AND WORKING-STORAGE SECTION.`);
        this.i += 2;
        this.expectPeriod(`${t.v} SECTION`);
        continue;
      }
      if (t.t === "word" && (t.v === "FD" || t.v === "SD")) {
        if (!inFS) cerr(t.line, "FD ENTRIES GO INTO THE FILE SECTION. WRITE FILE SECTION. FIRST.");
        if (!t.areaA) cerr(t.line, "FD BELONGS IN AREA A: START IT IN COLUMN 8.");
        this.i++;
        const n = this.peek();
        if (!n || n.t !== "word") cerr(t.line, "FD NEEDS THE FILE'S NAME.");
        if (!this.selects.some((x) => x.name === n.v)) cerr(t.line, `THERE IS NO SELECT FOR ${n.v}. EVERY FD NEEDS A SELECT … ASSIGN TO … IN THE ENVIRONMENT DIVISION.`);
        fd = n.v;
        this.i++;
        while (!this.atEnd() && !this.atPeriod()) this.i++; // RECORD CONTAINS …, LABEL RECORDS ARE STANDARD
        this.expectPeriod(`FD ${fd}`);
        continue;
      }
      if (inFS && !fd) cerr(t.line, "IN THE FILE SECTION, EVERY RECORD NEEDS AN FD ABOVE IT.");
      if (!inWS && !inFS) cerr(t.line, "DATA ITEMS GO INTO THE WORKING-STORAGE SECTION. WRITE WORKING-STORAGE SECTION. FIRST.");
      if (t.t !== "num" || !/^\d{1,2}$/.test(t.v)) cerr(t.line, `A DATA ENTRY STARTS WITH A LEVEL NUMBER LIKE 01, FOUND '${t.v}'.`);
      const level = parseInt(t.v, 10);
      if (!(level >= 1 && level <= 49) && level !== 77 && level !== 88) cerr(t.line, `LEVEL ${t.v} DOESN'T EXIST. USE 01 TO 49, 77 OR 88.`);
      if ((level === 1 || level === 77) && !t.areaA) cerr(t.line, `LEVEL ${t.v} BELONGS IN AREA A: START IT IN COLUMN 8.`);
      this.i++;
      let name = "FILLER";
      const nt = this.peek();
      if (nt && nt.t === "word" && !["PIC", "PICTURE", "VALUE", "VALUES", "OCCURS", "REDEFINES", "USAGE", "COMP", "COMP-3"].includes(nt.v)) {
        if (RESERVED.has(nt.v) && nt.v !== "FILLER") cerr(nt.line, `${nt.v} IS A RESERVED WORD AND CAN'T BE A DATA NAME.`);
        name = nt.v;
        this.i++;
      }
      const item: Item = {
        name, level, line: t.line, parent: null, children: [], pic: null, cat: "group", digits: 0, scale: 0, signed: false,
        size: 0, occurs: 1, base: 0, value: null, condValues: [], redefines: null, indexNames: [],
      };
      this.dataClauses(item);
      this.expectPeriod(`THE DATA ENTRY ${name}`);
      if (level === 88) {
        const parent = stack[stack.length - 1];
        if (!parent) cerr(t.line, "AN 88 LEVEL MUST FOLLOW THE ITEM IT DESCRIBES.");
        item.cat = "cond";
        item.parent = parent;
        parent.children.push(item);
        all.push(item);
        continue;
      }
      if (level === 1 || level === 77) {
        stack.length = 0;
        if (inFS && fd) item.file = fd;
      } else {
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        if (!stack.length) cerr(t.line, `LEVEL ${t.v} NEEDS A GROUP ABOVE IT, LIKE AN 01.`);
        const parent = stack[stack.length - 1];
        if (parent.pic) cerr(t.line, `${parent.name} HAS A PIC, SO IT CAN'T HAVE ITEMS BELOW IT. ONLY A GROUP (WITHOUT PIC) CAN.`);
        item.parent = parent;
        parent.children.push(item);
      }
      stack.push(item);
      all.push(item);
      for (const ix of item.indexNames) {
        // An index works like a small counter here
        const idx: Item = { ...item, file: undefined, name: ix, level: 77, parent: null, children: [], pic: "9(4)", cat: "numeric", digits: 4, scale: 0, signed: false, size: 4, occurs: 1, value: { k: "num", d: { n: 1n, s: 0 }, text: "1" }, condValues: [], redefines: null, indexNames: [] };
        all.push(idx);
      }
    }
    for (const it of all) {
      if (it.cat !== "cond" && !it.pic && !all.some((c) => c.parent === it && c.cat !== "cond"))
        cerr(it.line, `${it.name} NEEDS A PIC CLAUSE, LIKE PIC X(10) OR PIC 9(5).`);
    }
    return all;
  }

  dataClauses(item: Item) {
    while (!this.atEnd() && !this.atPeriod()) {
      const t = this.peek()!;
      if (t.t === "word" && (t.v === "PIC" || t.v === "PICTURE")) {
        this.i++;
        this.eatWord("IS");
        const p = this.peek();
        if (!p || p.t !== "pic") cerr(t.line, "THE PICTURE IS MISSING AFTER PIC.");
        describePic(item, p.v, p.line);
        this.i++;
      } else if (t.t === "word" && (t.v === "VALUE" || t.v === "VALUES")) {
        this.i++;
        this.eatWord("IS", "ARE");
        if (item.level === 88) {
          do {
            const a = this.literal();
            let b: Lit | null = null;
            if (this.eatWord("THRU", "THROUGH")) b = this.literal();
            item.condValues.push([a, b]);
          } while (!this.atEnd() && !this.atPeriod());
        } else item.value = this.literal();
      } else if (t.t === "word" && t.v === "OCCURS") {
        this.i++;
        const n = this.peek();
        if (!n || n.t !== "num" || !/^\d+$/.test(n.v)) cerr(t.line, "OCCURS NEEDS A NUMBER, LIKE OCCURS 12 TIMES.");
        item.occurs = parseInt(n.v, 10);
        if (item.occurs < 1 || item.occurs > 1000) cerr(t.line, "OCCURS MUST BE 1 TO 1000 HERE.");
        if (item.level === 1 || item.level === 77) cerr(t.line, "OCCURS CAN'T BE USED ON LEVEL 01 OR 77. PUT THE TABLE INSIDE A GROUP.");
        this.i++;
        this.eatWord("TIMES");
        if (this.eatWord("INDEXED")) {
          this.eatWord("BY");
          while (this.peek()?.t === "word" && !["PIC", "PICTURE", "VALUE"].includes(this.peek()!.v)) item.indexNames.push(this.peek()!.v), this.i++;
        }
      } else if (t.t === "word" && t.v === "REDEFINES") {
        this.i++;
        item.redefines = this.peek()?.v ?? null;
        this.i++;
      } else if (t.t === "word" && ["USAGE", "IS", "DISPLAY", "COMP", "COMP-3", "COMPUTATIONAL", "COMPUTATIONAL-3", "BINARY", "PACKED-DECIMAL"].includes(t.v)) {
        this.i++; // stored as display digits here; the value works the same
      } else cerr(t.line, `'${t.v}' DOESN'T BELONG IN A DATA ENTRY. DID YOU FORGET A PERIOD AFTER THE ENTRY BEFORE?`);
    }
  }

  literal(): Lit {
    const t = this.peek();
    if (!t) cerr(this.lastLine(), "A VALUE IS MISSING.");
    if (t.t === "num") {
      this.i++;
      return { k: "num", d: decOf(t.v), text: t.v };
    }
    if (t.t === "str") {
      this.i++;
      return { k: "str", s: t.v };
    }
    if (t.t === "word" && FIGURATIVE[t.v]) {
      this.i++;
      return FIGURATIVE[t.v];
    }
    if (t.t === "word" && t.v === "ALL") {
      this.i++;
      const s = this.peek();
      if (!s || s.t !== "str") cerr(t.line, 'ALL NEEDS A TEXT IN QUOTES, LIKE ALL "-".');
      this.i++;
      return { k: "fig", f: "ALL", s: s.v };
    }
    cerr(t.line, `'${t.v}' ISN'T A VALUE. USE A NUMBER, "TEXT" IN QUOTES, ZERO OR SPACES.`);
  }

  // ----- PROCEDURE DIVISION -----
  procedureDivision(): Para[] {
    // First find all paragraph names, so PERFORM and GO TO can point forward
    let n = 0;
    for (let k = this.i; k < this.toks.length; k++) {
      const t = this.toks[k];
      if (t.areaA && t.t === "word" && (this.toks[k + 1]?.t === "period" || (this.toks[k + 1]?.v === "SECTION" && this.toks[k + 2]?.t === "period"))) {
        this.paraNames.set(t.v, n++);
      }
    }
    const paras: Para[] = [];
    let current: Para | null = null;
    while (!this.atEnd()) {
      const t = this.peek()!;
      if (t.areaA) {
        if (t.t === "word" && this.paraNames.has(t.v) && (this.toks[this.i + 1]?.t === "period" || this.isWord("SECTION", 1))) {
          this.i++;
          this.eatWord("SECTION");
          this.i++; // the period
          current = { name: t.v, stmts: [], line: t.line };
          paras.push(current);
          continue;
        }
        if (t.t === "word" && VERBS.has(t.v)) cerr(t.line, `${t.v} STARTS IN AREA A. STATEMENTS BELONG IN AREA B: START THEM IN COLUMN 12.`);
        cerr(t.line, `'${t.v}' IN AREA A SHOULD BE A PARAGRAPH NAME FOLLOWED BY A PERIOD.`);
      }
      if (!current) {
        current = { name: "(START)", stmts: [], line: t.line };
        paras.push(current);
      }
      if (t.t === "period") {
        this.i++;
        continue;
      }
      current.stmts.push(...this.statements(new Set()));
      if (this.atEnd() && this.toks[this.i - 1]?.t !== "period") cerr(this.toks[this.i - 1].line, "A PERIOD IS MISSING AT THE END OF THE PROGRAM.");
      if (!this.atEnd()) {
        const nt = this.peek()!;
        if (nt.t === "period") this.i++;
        else if (nt.areaA) {
          const prev = this.toks[this.i - 1];
          cerr(prev.line, "A PERIOD IS MISSING AT THE END OF THE PARAGRAPH.");
        } else cerr(nt.line, `'${nt.v}' DOESN'T BELONG HERE.${TERMINATORS.has(nt.v) ? ` IS THERE AN ${nt.v} WITHOUT ITS START, OR A PERIOD TOO EARLY?` : ""}`);
      }
    }
    if (paras.length === 0 || paras.every((p) => p.stmts.length === 0)) cerr(this.lastLine(), "THE PROCEDURE DIVISION HAS NO STATEMENTS. ADD AT LEAST STOP RUN.");
    return paras;
  }

  // Statements until a period, an END-xxx, ELSE or WHEN
  statements(stop: Set<string>): Stmt[] {
    const out: Stmt[] = [];
    while (!this.atEnd()) {
      const t = this.peek()!;
      if (t.t === "period" || t.areaA) break;
      if (t.t === "word" && (stop.has(t.v) || TERMINATORS.has(t.v))) break;
      out.push(this.statement());
    }
    return out;
  }

  statement(): Stmt {
    const t = this.peek()!;
    const line = t.line;
    if (t.t !== "word" || !VERBS.has(t.v)) {
      if (t.t === "word" && this.isWord("SECTION", 1)) cerr(line, `${t.v} SECTION BELONGS IN AREA A.`);
      cerr(line, `'${t.v}' ISN'T A COBOL STATEMENT.${t.t === "word" && this.paraNames.has(t.v) ? " A PARAGRAPH NAME MUST START IN AREA A (COLUMN 8)." : " STATEMENTS START WITH A VERB LIKE DISPLAY, MOVE OR ADD."}`);
    }
    this.i++;
    switch (t.v) {
      case "DISPLAY": {
        const items: Expr[] = [];
        while (this.startsOperand()) items.push(this.operand());
        if (items.length === 0) cerr(line, "DISPLAY NEEDS SOMETHING TO SHOW.");
        let noAdvancing = false;
        if (this.eatWord("UPON")) this.i++;
        if (this.isWord("WITH") || this.isWord("NO")) {
          this.eatWord("WITH");
          this.expectWord("NO", "EXPECTED WITH NO ADVANCING");
          this.expectWord("ADVANCING", "EXPECTED WITH NO ADVANCING");
          noAdvancing = true;
        }
        return { k: "display", items, noAdvancing, line };
      }
      case "ACCEPT": {
        const ref = this.ref();
        let from: string | null = null;
        if (this.eatWord("FROM")) from = this.peek()!.v, this.i++;
        return { k: "accept", ref, from, line };
      }
      case "MOVE": {
        if (this.isWord("CORRESPONDING") || this.isWord("CORR")) cerr(line, "MOVE CORRESPONDING ISN'T USED IN THESE LESSONS.");
        const src = this.operand();
        this.expectWord("TO", "MOVE NEEDS TO: MOVE X TO Y");
        const targets: RefExpr[] = [];
        while (this.startsRef()) targets.push(this.ref());
        if (!targets.length) cerr(line, "MOVE … TO NEEDS AT LEAST ONE FIELD TO MOVE INTO.");
        return { k: "move", src, targets, line };
      }
      case "ADD":
      case "SUBTRACT":
      case "MULTIPLY":
      case "DIVIDE":
        return this.arith(t.v, line);
      case "COMPUTE": {
        const targets = this.targets();
        if (!targets.length) cerr(line, "COMPUTE NEEDS A FIELD FOR THE RESULT: COMPUTE X = …");
        if (!this.isOp("=") && !this.isWord("EQUAL")) cerr(line, "COMPUTE NEEDS = BETWEEN THE RESULT AND THE FORMULA.");
        this.i++;
        const e = this.expr();
        const size = this.sizePhrase("END-COMPUTE");
        return { k: "compute", targets, e, size, line };
      }
      case "IF": {
        const c = this.cond();
        this.eatWord("THEN");
        const then = this.statementsOrNext(new Set(["ELSE", "END-IF"]));
        let els: Stmt[] = [];
        if (this.eatWord("ELSE")) els = this.statementsOrNext(new Set(["END-IF"]));
        this.eatWord("END-IF");
        return { k: "if", c, then, else: els, line };
      }
      case "EVALUATE":
        return this.evaluate(line);
      case "PERFORM":
        return this.perform(line);
      case "GO": {
        this.eatWord("TO");
        const p = this.peek();
        if (!p || !this.paraNames.has(p.v)) cerr(line, `GO TO NEEDS A PARAGRAPH NAME${p ? `; THERE IS NO PARAGRAPH ${p.v}` : ""}.`);
        this.i++;
        return { k: "goto", para: this.paraNames.get(p.v)!, line };
      }
      case "STOP":
        this.expectWord("RUN", "STOP NEEDS RUN: STOP RUN");
        return { k: "stop", line };
      case "GOBACK":
        return { k: "stop", line };
      case "EXIT":
        this.eatWord("PROGRAM");
        return { k: "nop", line };
      case "CONTINUE":
        return { k: "nop", line };
      case "INITIALIZE": {
        const refs: RefExpr[] = [];
        while (this.startsRef()) refs.push(this.ref());
        return { k: "initialize", refs, line };
      }
      case "SET": {
        const refs: RefExpr[] = [];
        while (this.startsRef()) refs.push(this.ref());
        if (this.eatWord("UP")) {
          this.expectWord("BY", "SET … UP NEEDS BY");
          return { k: "set", refs, mode: "UP", value: this.operand(), line };
        }
        if (this.eatWord("DOWN")) {
          this.expectWord("BY", "SET … DOWN NEEDS BY");
          return { k: "set", refs, mode: "DOWN", value: this.operand(), line };
        }
        this.expectWord("TO", "SET NEEDS TO");
        if (this.eatWord("TRUE")) return { k: "set", refs, mode: "TRUE", value: null, line };
        return { k: "set", refs, mode: "TO", value: this.operand(), line };
      }
      case "STRING": {
        const parts: { e: Expr; delim: Expr | "SIZE" }[] = [];
        while (this.startsOperand() && !this.isWord("INTO")) {
          const group: Expr[] = [];
          while (this.startsOperand() && !this.isWord("DELIMITED") && !this.isWord("INTO")) group.push(this.operand());
          let delim: Expr | "SIZE" = "SIZE";
          if (this.eatWord("DELIMITED")) {
            this.eatWord("BY");
            delim = this.eatWord("SIZE") ? "SIZE" : this.operand();
          }
          for (const e of group) parts.push({ e, delim });
        }
        this.expectWord("INTO", "STRING NEEDS INTO");
        const into = this.ref();
        let pointer: RefExpr | null = null;
        if (this.eatWord("WITH")) {
          this.expectWord("POINTER", "EXPECTED WITH POINTER");
          pointer = this.ref();
        } else if (this.eatWord("POINTER")) pointer = this.ref();
        this.eatWord("END-STRING");
        return { k: "string", parts, into, pointer, line };
      }
      case "INSPECT": {
        const ref = this.ref();
        const tallying: { counter: RefExpr; what: "ALL" | "LEADING" | "CHARACTERS"; e: Expr | null }[] = [];
        const replacing: { what: "ALL" | "LEADING" | "FIRST" | "CHARACTERS"; from: Expr | null; to: Expr }[] = [];
        if (this.eatWord("TALLYING")) {
          const counter = this.ref();
          this.expectWord("FOR", "INSPECT … TALLYING NEEDS FOR");
          for (;;) {
            const w = this.eatWord("ALL", "LEADING", "CHARACTERS") as "ALL" | "LEADING" | "CHARACTERS" | null;
            if (!w) break;
            tallying.push({ counter, what: w, e: w === "CHARACTERS" ? null : this.operand() });
          }
          if (!tallying.length) cerr(line, "INSPECT … TALLYING … FOR NEEDS ALL, LEADING OR CHARACTERS.");
        }
        if (this.eatWord("REPLACING")) {
          for (;;) {
            const w = this.eatWord("ALL", "LEADING", "FIRST", "CHARACTERS") as "ALL" | "LEADING" | "FIRST" | "CHARACTERS" | null;
            if (!w) break;
            const from = w === "CHARACTERS" ? null : this.operand();
            this.expectWord("BY", "REPLACING NEEDS BY");
            replacing.push({ what: w, from, to: this.operand() });
          }
          if (!replacing.length) cerr(line, "INSPECT … REPLACING NEEDS ALL, LEADING, FIRST OR CHARACTERS.");
        }
        this.eatWord("END-INSPECT");
        return { k: "inspect", ref, tallying, replacing, line };
      }
      case "OPEN": {
        const files: { mode: string; name: string }[] = [];
        let mode: string | null = null;
        for (;;) {
          const m = this.eatWord("INPUT", "OUTPUT", "EXTEND");
          if (m) mode = m;
          if (!mode) cerr(line, "OPEN NEEDS INPUT, OUTPUT OR EXTEND: OPEN INPUT SALES-FILE.");
          if (!this.startsRef()) break;
          files.push({ mode, name: this.peek()!.v });
          this.i++;
        }
        if (!files.length) cerr(line, "OPEN NEEDS A FILE NAME.");
        return { k: "open", files, line };
      }
      case "CLOSE": {
        const names: string[] = [];
        while (this.startsRef()) names.push(this.peek()!.v), this.i++;
        if (!names.length) cerr(line, "CLOSE NEEDS A FILE NAME.");
        return { k: "close", names, line };
      }
      case "READ": {
        const f = this.peek();
        if (!f || f.t !== "word") cerr(line, "READ NEEDS A FILE NAME: READ SALES-FILE.");
        this.i++;
        this.eatWord("NEXT");
        this.eatWord("RECORD");
        const into = this.eatWord("INTO") ? this.ref() : null;
        let atEnd: Stmt[] | null = null;
        let notAtEnd: Stmt[] | null = null;
        for (;;) {
          if (this.isWord("AT") || this.isWord("END")) {
            this.eatWord("AT");
            this.expectWord("END", "EXPECTED AT END");
            atEnd = this.statements(new Set(["NOT", "END-READ"]));
          } else if (this.isWord("NOT") && (this.isWord("AT", 1) || this.isWord("END", 1))) {
            this.i++;
            this.eatWord("AT");
            this.expectWord("END", "EXPECTED NOT AT END");
            notAtEnd = this.statements(new Set(["END-READ"]));
          } else break;
        }
        this.eatWord("END-READ");
        return { k: "read", file: f.v, into, atEnd, notAtEnd, line };
      }
      case "WRITE": {
        const rec = this.ref();
        const from = this.eatWord("FROM") ? this.operand() : null;
        let lines: Expr | null = null;
        let page = false;
        let before = false;
        const when = this.eatWord("BEFORE", "AFTER");
        if (when) {
          before = when === "BEFORE";
          this.eatWord("ADVANCING");
          if (this.eatWord("PAGE")) page = true;
          else {
            lines = this.operand();
            this.eatWord("LINE", "LINES");
          }
        }
        this.eatWord("END-WRITE");
        return { k: "write", rec, from, lines, page, before, line };
      }
      case "SEARCH": {
        if (this.isWord("ALL")) cerr(line, "SEARCH ALL ISN'T USED IN THESE LESSONS. USE SEARCH.");
        const table = this.ref();
        if (this.eatWord("VARYING")) this.ref();
        let atEnd: Stmt[] | null = null;
        if (this.isWord("AT") || this.isWord("END")) {
          this.eatWord("AT");
          this.expectWord("END", "EXPECTED AT END");
          atEnd = this.statements(new Set(["WHEN", "END-SEARCH"]));
        }
        const whens: { c: Cond; stmts: Stmt[] }[] = [];
        while (this.eatWord("WHEN")) {
          const c = this.cond();
          whens.push({ c, stmts: this.statements(new Set(["WHEN", "END-SEARCH"])) });
        }
        if (!whens.length) cerr(line, "SEARCH NEEDS AT LEAST ONE WHEN.");
        this.eatWord("END-SEARCH");
        return { k: "search", table, atEnd, whens, line };
      }
      default:
        cerr(line, `${t.v} ISN'T USED IN THESE LESSONS YET.`);
    }
  }

  // NEXT SENTENCE is the old way of saying "nothing"
  statementsOrNext(stop: Set<string>): Stmt[] {
    if (this.isWord("NEXT") && this.isWord("SENTENCE", 1)) cerr(this.peek()!.line, "NEXT SENTENCE ISN'T USED HERE. WRITE CONTINUE TO DO NOTHING.");
    const s = this.statements(stop);
    if (s.length === 0 && !this.atEnd()) {
      const t = this.peek()!;
      if (t.t === "word" && ["ELSE", "END-IF"].includes(t.v) && !stop.has("WHEN")) return [{ k: "nop", line: t.line }];
      if (t.t !== "period") cerr(t.line, `A STATEMENT IS MISSING BEFORE '${t.v}'.`);
    }
    return s;
  }

  arith(verb: string, line: number): Stmt {
    const operands: Expr[] = [];
    while (this.startsOperand() && !this.isWord("TO") && !this.isWord("FROM") && !this.isWord("BY") && !this.isWord("INTO") && !this.isWord("GIVING")) operands.push(this.operand());
    if (!operands.length) cerr(line, `${verb} NEEDS A NUMBER OR FIELD.`);
    let to: Target[] = [];
    let giving: Target[] = [];
    let remainder: Target | null = null;
    let byFirst = false;
    const joiner = verb === "ADD" ? "TO" : verb === "SUBTRACT" ? "FROM" : verb === "MULTIPLY" ? "BY" : null;
    if (verb === "DIVIDE") {
      if (this.eatWord("INTO")) to = this.targetsOrOperands(operands);
      else if (this.eatWord("BY")) {
        byFirst = true;
        operands.push(this.operand());
        if (!this.isWord("GIVING")) cerr(line, "DIVIDE … BY NEEDS GIVING: DIVIDE A BY B GIVING C.");
      } else cerr(line, "DIVIDE NEEDS INTO OR BY: DIVIDE 2 INTO X, OR DIVIDE X BY 2 GIVING Y.");
    } else if (joiner && this.eatWord(joiner)) to = this.targetsOrOperands(operands);
    else if (verb !== "ADD" || !this.isWord("GIVING")) cerr(line, `${verb} NEEDS ${joiner}.`);
    if (this.eatWord("GIVING")) {
      giving = this.targets();
      if (!giving.length) cerr(line, "GIVING NEEDS A FIELD FOR THE RESULT.");
    }
    if (this.eatWord("REMAINDER")) {
      if (verb !== "DIVIDE") cerr(line, "REMAINDER ONLY WORKS WITH DIVIDE.");
      remainder = { ref: this.ref(), rounded: false };
    }
    if ((verb === "SUBTRACT" || verb === "MULTIPLY" || verb === "DIVIDE") && !to.length && !giving.length) cerr(line, `${verb} NEEDS A FIELD FOR THE RESULT.`);
    const size = this.sizePhrase(`END-${verb}`);
    return { k: "arith", verb, operands, to, giving, remainder, byFirst, size, line };
  }

  // ADD 1 TO X: X is a target. ADD 1 TO X GIVING Y (or 100 GIVING Y): just operands.
  targetsOrOperands(operands: Expr[]): Target[] {
    const items: ({ lit: Expr; line: number; text: string } | { target: Target })[] = [];
    for (;;) {
      const t = this.peek();
      if (t && t.t === "num") {
        this.i++;
        items.push({ lit: { k: "lit", lit: { k: "num", d: decOf(t.v), text: t.v }, line: t.line }, line: t.line, text: t.v });
      } else if (this.startsRef()) {
        const ref = this.ref();
        items.push({ target: { ref, rounded: !!this.eatWord("ROUNDED") } });
      } else break;
    }
    if (this.isWord("GIVING")) {
      for (const x of items) operands.push("lit" in x ? x.lit : { k: "ref", ref: x.target.ref });
      return [];
    }
    return items.map((x) => {
      if ("lit" in x) cerr(x.line, `${x.text} IS A NUMBER, NOT A FIELD: THE RESULT NEEDS A FIELD TO GO INTO.`);
      return x.target;
    });
  }

  targets(): Target[] {
    const out: Target[] = [];
    for (;;) {
      if (!this.startsRef()) break;
      const ref = this.ref();
      out.push({ ref, rounded: !!this.eatWord("ROUNDED") });
    }
    return out;
  }

  sizePhrase(end: string): SizePhrase {
    const p: SizePhrase = { onError: null, notOnError: null };
    for (;;) {
      if (this.isWord("ON") && this.isWord("SIZE", 1)) {
        this.i += 2;
        this.expectWord("ERROR", "EXPECTED ON SIZE ERROR");
        p.onError = this.statements(new Set(["NOT", end]));
      } else if (this.isWord("SIZE") && this.isWord("ERROR", 1)) {
        this.i += 2;
        p.onError = this.statements(new Set(["NOT", end]));
      } else if (this.isWord("NOT") && (this.isWord("ON", 1) || this.isWord("SIZE", 1))) {
        this.i++;
        this.eatWord("ON");
        this.expectWord("SIZE", "EXPECTED NOT ON SIZE ERROR");
        this.expectWord("ERROR", "EXPECTED NOT ON SIZE ERROR");
        p.notOnError = this.statements(new Set([end]));
      } else break;
    }
    this.eatWord(end);
    return p;
  }

  evaluate(line: number): Stmt {
    let subject: Expr | "TRUE" | "FALSE";
    if (this.eatWord("TRUE")) subject = "TRUE";
    else if (this.eatWord("FALSE")) subject = "FALSE";
    else subject = this.expr();
    const whens: { objs: ({ not: boolean; a: Expr; thru: Expr | null } | { cond: Cond } | "ANY")[]; stmts: Stmt[] }[] = [];
    let other: Stmt[] | null = null;
    if (!this.isWord("WHEN")) cerr(line, "EVALUATE NEEDS AT LEAST ONE WHEN.");
    while (this.eatWord("WHEN")) {
      if (this.eatWord("OTHER")) {
        other = this.statements(new Set(["WHEN", "END-EVALUATE"]));
        continue;
      }
      const objs: ({ not: boolean; a: Expr; thru: Expr | null } | { cond: Cond } | "ANY")[] = [];
      for (;;) {
        if (this.eatWord("ANY")) objs.push("ANY");
        else if (subject === "TRUE" || subject === "FALSE") objs.push({ cond: this.cond() });
        else {
          const not = !!this.eatWord("NOT");
          const a = this.expr();
          const thru = this.eatWord("THRU", "THROUGH") ? this.expr() : null;
          objs.push({ not, a, thru });
        }
        if (this.isWord("WHEN") && !this.isWord("OTHER", 1) && this.nextWhenIsEmpty()) {
          this.i++;
          continue;
        }
        break;
      }
      whens.push({ objs, stmts: this.statements(new Set(["WHEN", "END-EVALUATE"])) });
    }
    this.eatWord("END-EVALUATE");
    return { k: "evaluate", subject, whens, other, line };
  }
  // WHEN 1 WHEN 2 DISPLAY …: the first WHEN has no statements of its own
  nextWhenIsEmpty() {
    return true;
  }

  perform(line: number): Stmt {
    const s: Stmt & { k: "perform" } = { k: "perform", para: null, thru: null, body: null, times: null, until: null, testAfter: false, varying: [], line };
    const t = this.peek();
    if (t && t.t === "word" && this.paraNames.has(t.v)) {
      this.i++;
      s.para = this.paraNames.get(t.v)!;
      if (this.eatWord("THRU", "THROUGH")) {
        const e = this.peek();
        if (!e || !this.paraNames.has(e.v)) cerr(line, "PERFORM … THRU NEEDS A PARAGRAPH NAME.");
        this.i++;
        s.thru = this.paraNames.get(e.v)!;
      }
    } else if (t && t.t === "word" && !["UNTIL", "VARYING", "WITH", "TEST"].includes(t.v) && !VERBS.has(t.v) && !(this.peek(1)?.v === "TIMES")) {
      cerr(line, `THERE IS NO PARAGRAPH ${t.v}. PARAGRAPH NAMES START IN AREA A AND END WITH A PERIOD.`);
    }
    // n TIMES
    if (this.startsOperand() && (this.peek(1)?.v === "TIMES" || (this.peek()?.t === "word" && this.peek(1)?.v === "TIMES"))) {
      s.times = this.operand();
      this.expectWord("TIMES", "EXPECTED TIMES");
    }
    if (this.eatWord("WITH")) {
      this.expectWord("TEST", "EXPECTED WITH TEST BEFORE OR AFTER");
      s.testAfter = this.eatWord("AFTER", "BEFORE") === "AFTER";
    }
    if (this.eatWord("UNTIL")) s.until = this.cond();
    else if (this.eatWord("VARYING")) {
      do {
        const ref = this.ref();
        this.expectWord("FROM", "VARYING NEEDS FROM: VARYING I FROM 1 BY 1 UNTIL I > 10");
        const from = this.operand();
        this.expectWord("BY", "VARYING NEEDS BY: VARYING I FROM 1 BY 1 UNTIL I > 10");
        const by = this.operand();
        this.expectWord("UNTIL", "VARYING NEEDS UNTIL: VARYING I FROM 1 BY 1 UNTIL I > 10");
        s.varying.push({ ref, from, by, until: this.cond() });
      } while (this.eatWord("AFTER"));
    }
    if (s.para === null) {
      s.body = this.statements(new Set(["END-PERFORM"]));
      if (!this.eatWord("END-PERFORM")) cerr(this.peek()?.line ?? line, "AN INLINE PERFORM NEEDS END-PERFORM AT ITS END.");
    }
    return s;
  }

  // ----- operands and expressions -----
  startsOperand() {
    const t = this.peek();
    if (!t) return false;
    if (t.t === "num" || t.t === "str") return true;
    if (t.t === "op" && (t.v === "(" || t.v === "-" || t.v === "+")) return true;
    if (t.t !== "word") return false;
    if (FIGURATIVE[t.v] || t.v === "ALL") return true;
    return !RESERVED.has(t.v) && !t.areaA;
  }
  startsRef() {
    const t = this.peek();
    return !!t && t.t === "word" && !RESERVED.has(t.v) && !t.areaA;
  }
  ref(): RefExpr {
    const t = this.peek();
    if (!t || t.t !== "word" || RESERVED.has(t.v)) cerr(t?.line ?? this.lastLine(), `A FIELD NAME WAS EXPECTED${t ? `, FOUND '${t.v}'` : ""}.`);
    this.i++;
    const r: RefExpr = { name: t.v, quals: [], subs: [], refMod: null, line: t.line };
    while (this.isWord("OF") || this.isWord("IN")) {
      this.i++;
      r.quals.push(this.peek()!.v);
      this.i++;
    }
    if (this.isOp("(")) {
      // subscripts, or a reference modification (start:length)
      const save = this.i;
      this.i++;
      const first = this.expr();
      if (this.isOp(":")) {
        this.i++;
        const len = this.isOp(")") ? null : this.expr();
        if (!this.isOp(")")) cerr(t.line, "A ) IS MISSING.");
        this.i++;
        r.refMod = [first, len];
        return r;
      }
      r.subs.push(first);
      while (!this.isOp(")")) {
        if (this.atEnd() || this.atPeriod()) {
          this.i = save;
          cerr(t.line, `THE ( AFTER ${t.v} IS NEVER CLOSED.`);
        }
        r.subs.push(this.expr());
      }
      this.i++;
      if (this.isOp("(")) {
        this.i++;
        const start = this.expr();
        if (!this.isOp(":")) cerr(t.line, "EXPECTED (START:LENGTH).");
        this.i++;
        const len = this.isOp(")") ? null : this.expr();
        this.i++;
        r.refMod = [start, len];
      }
    }
    return r;
  }
  operand(): Expr {
    const t = this.peek();
    if (t && t.t === "str") {
      this.i++;
      return { k: "lit", lit: { k: "str", s: t.v }, line: t.line };
    }
    if (t && t.t === "word" && (FIGURATIVE[t.v] || t.v === "ALL")) return { k: "lit", lit: this.literal(), line: t.line };
    return this.expr();
  }
  expr(): Expr {
    let a = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.peek()!;
      this.i++;
      a = { k: "bin", op: op.v, a, b: this.term(), line: op.line };
    }
    return a;
  }
  term(): Expr {
    let a = this.factor();
    while (this.isOp("*") || this.isOp("/")) {
      const op = this.peek()!;
      this.i++;
      a = { k: "bin", op: op.v, a, b: this.factor(), line: op.line };
    }
    return a;
  }
  factor(): Expr {
    const a = this.unary();
    if (this.isOp("**")) {
      const op = this.peek()!;
      this.i++;
      return { k: "bin", op: "**", a, b: this.factor(), line: op.line };
    }
    return a;
  }
  unary(): Expr {
    if (this.isOp("-")) {
      const line = this.peek()!.line;
      this.i++;
      return { k: "neg", e: this.unary(), line };
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.primary();
  }
  primary(): Expr {
    const t = this.peek();
    if (!t) cerr(this.lastLine(), "A VALUE IS MISSING AT THE END.");
    if (t.t === "num") {
      this.i++;
      return { k: "lit", lit: { k: "num", d: decOf(t.v), text: t.v }, line: t.line };
    }
    if (t.t === "str") {
      this.i++;
      return { k: "lit", lit: { k: "str", s: t.v }, line: t.line };
    }
    if (t.t === "op" && t.v === "(") {
      this.i++;
      const e = this.expr();
      if (!this.isOp(")")) cerr(t.line, "A ) IS MISSING.");
      this.i++;
      return e;
    }
    if (t.t === "word" && FIGURATIVE[t.v]) {
      this.i++;
      return { k: "lit", lit: FIGURATIVE[t.v], line: t.line };
    }
    if (t.t === "word" && !RESERVED.has(t.v)) return { k: "ref", ref: this.ref() };
    cerr(t.line, t.t === "period" ? "SOMETHING IS MISSING BEFORE THE PERIOD." : `'${t.v}' WAS FOUND WHERE A VALUE OR FIELD SHOULD BE.`);
  }

  // ----- conditions -----
  lastRel: { a: Expr; op: string } | null = null;
  cond(): Cond {
    this.lastRel = null;
    return this.orCond();
  }
  orCond(): Cond {
    let a = this.andCond();
    while (this.eatWord("OR")) a = { k: "or", a, b: this.andCond() };
    return a;
  }
  andCond(): Cond {
    let a = this.notCond();
    while (this.eatWord("AND")) a = { k: "and", a, b: this.notCond() };
    return a;
  }
  notCond(): Cond {
    if (this.isWord("NOT") && !this.relAhead(1)) {
      this.i++;
      return { k: "not", c: this.notCond() };
    }
    return this.primaryCond();
  }
  relAhead(o: number) {
    const t = this.peek(o);
    return !!t && ((t.t === "op" && ["=", ">", "<", ">=", "<=", "<>"].includes(t.v)) || (t.t === "word" && ["EQUAL", "GREATER", "LESS"].includes(t.v)));
  }
  primaryCond(): Cond {
    const t = this.peek();
    if (!t) cerr(this.lastLine(), "A CONDITION IS MISSING.");
    if (t.t === "op" && t.v === "(") {
      // a condition in brackets, or an arithmetic expression on the left
      const save = this.i;
      this.i++;
      const saved = this.lastRel;
      try {
        const c = this.orCond();
        if (this.isOp(")")) {
          this.i++;
          if (!this.relAhead(0) && !this.isWord("IS")) return c;
        }
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
      }
      this.i = save;
      this.lastRel = saved;
    }
    // a condition name (88 level), alone
    if (t.t === "word" && !RESERVED.has(t.v)) {
      const save = this.i;
      const r = this.ref();
      if (!this.relAhead(0) && !this.isWord("IS") && !(this.isWord("NOT") && (this.relAhead(1) || this.classAhead(1))) && !this.classAhead(0)) return { k: "name", ref: r };
      this.i = save;
    }
    const line = t.line;
    const a = this.operand();
    if (this.lastRel && !this.relAhead(0) && !this.isWord("IS") && !this.isWord("NOT") && !this.classAhead(0)) {
      // abbreviated: IF X = 1 OR 2
      return { k: "rel", a: this.lastRel.a, op: this.lastRel.op, b: a, line };
    }
    this.eatWord("IS");
    let not = !!this.eatWord("NOT");
    if (this.classAhead(0)) {
      const cls = this.peek()!.v;
      this.i++;
      return { k: "class", a, cls, not, line };
    }
    let op = this.relOp(line);
    if (not) op = op === "=" ? "<>" : op === ">" ? "<=" : op === "<" ? ">=" : op === ">=" ? "<" : op === "<=" ? ">" : "=";
    not = false;
    const b = this.operand();
    this.lastRel = { a, op };
    return { k: "rel", a, op, b, line };
  }
  classAhead(o: number) {
    const t = this.peek(o);
    return !!t && t.t === "word" && ["NUMERIC", "ALPHABETIC", "POSITIVE", "NEGATIVE", "ZERO", "ZEROS", "ZEROES"].includes(t.v) && !this.relAhead(o + 1);
  }
  relOp(line: number): string {
    const t = this.peek();
    if (t && t.t === "op" && ["=", ">", "<", ">=", "<=", "<>"].includes(t.v)) {
      this.i++;
      return t.v;
    }
    if (this.eatWord("EQUAL")) {
      this.eatWord("TO");
      return "=";
    }
    const w = this.eatWord("GREATER", "LESS");
    if (w) {
      this.eatWord("THAN");
      if (this.eatWord("OR")) {
        this.expectWord("EQUAL", "EXPECTED OR EQUAL");
        this.eatWord("TO");
        return w === "GREATER" ? ">=" : "<=";
      }
      return w === "GREATER" ? ">" : "<";
    }
    cerr(line, `A COMPARISON LIKE = OR > IS MISSING${t ? ` BEFORE '${t.v}'` : ""}.`);
  }
}

// ---------- The disk ----------
// Files that are already on the mainframe's disk, one record per line, fixed columns
export const COBOL_START_FILES: Record<string, string[]> = {
  // SALES: region (1-6), salesperson (7-16), amount in cents (17-23, PIC 9(5)V99). Sorted by region.
  SALES: [
    "NORTH ADA       0012050",
    "NORTH GRACE     0009875",
    "NORTH KEN       0020000",
    "SOUTH DENNIS    0015025",
    "SOUTH NIKLAUS   0004500",
    "WEST  JOHN      0030000",
  ],
  // CUSTOMERS: number (1-5), name (6-17), city (18-27), balance (28-34, PIC 9(5)V99)
  CUSTOMERS: [
    "00007GRACE HOPPERNEW YORK  0250000",
    "00042ADA LOVELACELONDON    0181536",
    "01959JOHN BACKUS PHILADELPH0012000",
    "02024LINUS T.    HELSINKI  0000999",
  ],
  // TRANS: account (1-5), D for a deposit or W for a withdrawal (6), amount (7-13, PIC 9(5)V99). Sorted by account.
  TRANS: [
    "00007D0010000",
    "00007W0002550",
    "00042D0050000",
    "00042W0012000",
    "00042W0000999",
    "01959D0001000",
  ],
};
const PRINTERS = new Set(["PRINTER", "SYSOUT", "SYSPRINT", "PRINT"]);
type OpenFile = { sel: Select; mode: string | null; pos: number; atEnd: boolean; printer: boolean };

// ---------- Running ----------

type Ref = { item: Item; addr: number; len: number };
type Val = { k: "num"; d: Dec; text?: string } | { k: "str"; s: string } | { k: "fig"; f: string; s?: string };

class Machine {
  mem: string[] = [];
  steps = 0;
  depth = 0;
  out = "";
  inPos = 0;
  byName = new Map<string, Item[]>();

  disk = new Map<string, string[]>(Object.entries(COBOL_START_FILES).map(([k, v]) => [k, [...v]]));
  files = new Map<string, OpenFile>();

  constructor(
    public items: Item[],
    public paras: Para[],
    public inputs: string[],
    selects: Select[] = []
  ) {
    for (const sel of selects) this.files.set(sel.name, { sel, mode: null, pos: 0, atEnd: false, printer: PRINTERS.has(sel.assign) });
    for (const it of items) {
      const list = this.byName.get(it.name) ?? [];
      list.push(it);
      this.byName.set(it.name, list);
    }
    this.layout();
  }

  // Give every item its place in memory
  layout() {
    let pos = 0;
    const place = (it: Item, start: number): number => {
      it.base = start;
      if (it.cat === "cond") return 0;
      const kids = it.children.filter((c) => c.cat !== "cond");
      if (kids.length) {
        let p = start;
        for (const c of kids) {
          if (c.redefines) {
            const target = kids.find((x) => x.name === c.redefines);
            if (!target) cerr(c.line, `${c.name} REDEFINES ${c.redefines}, BUT THERE IS NO ${c.redefines} RIGHT BEFORE IT.`);
            place(c, target.base);
            continue;
          }
          const sz = place(c, p);
          p += sz * c.occurs;
        }
        if (!it.pic) it.size = p - start;
      }
      return it.size;
    };
    const fileRecords = new Map<string, Item>();
    for (const it of this.items) {
      if (it.parent || it.cat === "cond") continue;
      // All records of one file share the same record area
      if (it.file) {
        const first = fileRecords.get(it.file);
        if (first) {
          place(it, first.base);
          if (it.size > first.size) pos = Math.max(pos, first.base + it.size);
          continue;
        }
        fileRecords.set(it.file, it);
      }
      if (it.redefines) {
        const target = this.items.find((x) => x.name === it.redefines && !x.parent);
        if (!target) cerr(it.line, `${it.name} REDEFINES ${it.redefines}, BUT THERE IS NO ${it.redefines}.`);
        place(it, target.base);
        continue;
      }
      pos += place(it, pos);
    }
    this.mem = Array(pos).fill(" ");
    // VALUE clauses
    for (const it of this.items) {
      if (it.cat === "cond" || !it.value) continue;
      if (it.cat === "numeric" && it.value.k === "str") cerr(it.line, `${it.name} IS A NUMBER (PIC ${it.pic}), BUT ITS VALUE IS TEXT IN QUOTES.`);
      if ((it.cat === "alnum" || it.cat === "group") && it.value.k === "num") cerr(it.line, `${it.name} HOLDS TEXT, SO ITS VALUE NEEDS QUOTES: VALUE "${it.value.text}".`);
      if (it.cat === "numeric" && it.value.k === "num") {
        const d = it.value.d;
        const fit = rescale(d, it.scale);
        if (cmpDec(fit, d) !== 0 || fit.n.toString().replace("-", "").length > it.digits) cerr(it.line, `THE VALUE ${it.value.text} DOESN'T FIT INTO PIC ${it.pic}.`);
        if (d.n < 0n && !it.signed) cerr(it.line, `THE VALUE ${it.value.text} IS NEGATIVE, BUT PIC ${it.pic} HAS NO S FOR A SIGN.`);
      }
      if (it.value.k === "str" && it.value.s.length > it.size) cerr(it.line, `THE VALUE "${it.value.s}" HAS ${it.value.s.length} CHARACTERS, BUT ${it.name} ONLY HAS ROOM FOR ${it.size}.`);
      for (const addr of this.occurrences(it)) this.moveLit(it.value, { item: it, addr, len: it.size }, it.line);
    }
  }

  // The address of every occurrence of an item (all subscripts)
  occurrences(it: Item): number[] {
    const chain: Item[] = [];
    for (let p: Item | null = it; p; p = p.parent) if (p.occurs > 1) chain.unshift(p);
    let addrs = [it.base];
    for (const c of chain) addrs = addrs.flatMap((a) => Array.from({ length: c.occurs }, (_, k) => a + k * c.size));
    return addrs;
  }

  step(line: number) {
    if (++this.steps > MAX_STEPS) abend("S322", "TIME LIMIT", line, "THE JOB RAN TOO LONG AND WAS CANCELLED. IS THERE A LOOP THAT NEVER ENDS?");
  }
  write(s: string) {
    this.out += s;
    if (this.out.length > MAX_OUTPUT) abend("S722", "OUTPUT LIMIT", 0, "THE JOB PRINTED TOO MUCH. CHECK YOUR LOOPS.");
  }

  // ----- finding data -----
  find(r: RefExpr): Item {
    const list = this.byName.get(r.name);
    if (!list) {
      if (r.name.startsWith("\u0000")) cerr(r.line, `${r.name.slice(1)} IS A NUMBER, NOT A FIELD.`);
      cerr(r.line, `${r.name} IS NOT DEFINED. DECLARE IT IN THE WORKING-STORAGE SECTION.`);
    }
    const ok = list.filter((it) => {
      let p = it.parent;
      for (const q of r.quals) {
        while (p && p.name !== q) p = p.parent;
        if (!p) return false;
        p = p.parent;
      }
      return true;
    });
    if (ok.length === 0) cerr(r.line, `THERE IS NO ${r.name} IN ${r.quals.join(" OF ")}.`);
    if (ok.length > 1) cerr(r.line, `${r.name} IS DEFINED MORE THAN ONCE. SAY WHICH ONE: ${r.name} OF ${ok[0].parent?.name ?? "…"}.`);
    return ok[0];
  }
  resolve(r: RefExpr): Ref {
    const it = this.find(r);
    if (it.cat === "cond") cerr(r.line, `${it.name} IS A CONDITION (88 LEVEL). USE IT IN AN IF, OR SET ${it.name} TO TRUE.`);
    const chain: Item[] = [];
    for (let p: Item | null = it; p; p = p.parent) if (p.occurs > 1) chain.unshift(p);
    if (r.subs.length !== chain.length) {
      if (chain.length === 0) cerr(r.line, `${it.name} IS NOT A TABLE (NO OCCURS), SO IT TAKES NO SUBSCRIPT.`);
      cerr(r.line, `${it.name} IS IN A TABLE AND NEEDS ${chain.length} SUBSCRIPT${chain.length > 1 ? "S" : ""}, LIKE ${it.name}(${chain.map(() => "I").join(", ")}).`);
    }
    let addr = it.base;
    chain.forEach((c, k) => {
      const d = this.num(r.subs[k], r.line);
      const n = Number(rescale(d, 0).n);
      if (n < 1 || n > c.occurs) abend("IGZ0006S", "SUBSCRIPT OUT OF RANGE", r.line, `${it.name}(${n}) IS OUTSIDE THE TABLE: ${c.name} OCCURS ${c.occurs} TIMES, SO 1 TO ${c.occurs}.`);
      addr += (n - 1) * c.size;
    });
    let len = it.size;
    if (r.refMod) {
      const start = Number(rescale(this.num(r.refMod[0], r.line), 0).n);
      const l = r.refMod[1] ? Number(rescale(this.num(r.refMod[1], r.line), 0).n) : len - start + 1;
      if (start < 1 || l < 1 || start + l - 1 > len) abend("IGZ0072S", "REFERENCE OUT OF RANGE", r.line, `${it.name}(${start}:${l}) IS OUTSIDE ${it.name}, WHICH HAS ${len} CHARACTERS.`);
      return { item: { ...it, cat: "alnum", size: l }, addr: addr + start - 1, len: l };
    }
    return { item: it, addr, len };
  }

  text(ref: Ref): string {
    return this.mem.slice(ref.addr, ref.addr + ref.len).join("");
  }
  setText(ref: Ref, s: string) {
    for (let k = 0; k < ref.len; k++) this.mem[ref.addr + k] = s[k] ?? " ";
  }

  // The number in a numeric field: digits, the last one may carry the sign ( } J-R for negative )
  readNum(ref: Ref, line: number): Dec {
    const it = ref.item;
    if (it.cat === "edited") cerr(line, `${it.name} IS AN EDITED FIELD (PIC ${it.pic}), MADE FOR PRINTING. CALCULATE WITH A PIC 9 FIELD AND MOVE THE RESULT INTO ${it.name}.`);
    if (it.cat !== "numeric") cerr(line, `${it.name} HOLDS TEXT (PIC ${it.pic ?? "GROUP"}), SO IT CAN'T BE USED IN A CALCULATION. USE A PIC 9 FIELD.`);
    const raw = this.text(ref);
    let digits = raw;
    let neg = false;
    const last = raw[raw.length - 1];
    const negIdx = "}JKLMNOPQR".indexOf(last);
    if (it.signed && negIdx >= 0) {
      neg = true;
      digits = raw.slice(0, -1) + String(negIdx);
    }
    if (!/^\d+$/.test(digits))
      abend("S0C7", "DATA EXCEPTION", line, `${it.name} DOESN'T HOLD A VALID NUMBER (IT HOLDS "${raw}"). ${/^ +$/.test(raw) ? `GIVE IT A START VALUE: VALUE ZERO.` : "WAS TEXT MOVED INTO IT?"}`);
    return { n: BigInt(digits) * (neg ? -1n : 1n), s: it.scale };
  }
  // Store a number; returns false if digits were lost at the front (a size error)
  storeNum(ref: Ref, d: Dec, rounded: boolean, line: number, check = false): boolean {
    const it = ref.item;
    if (it.cat === "edited") {
      const v = rescale(d, it.scale, rounded);
      const fits = (v.n < 0n ? -v.n : v.n).toString().length <= it.digits;
      if (check && !fits) return false;
      this.setText(ref, editNumber(it.pic!, v, it.digits, it.scale));
      return fits;
    }
    if (it.cat !== "numeric") cerr(line, `${it.name} HOLDS TEXT (PIC ${it.pic ?? "GROUP"}), SO IT CAN'T TAKE THE RESULT OF A CALCULATION. USE A PIC 9 FIELD.`);
    const v = rescale(d, it.scale, rounded);
    const neg = v.n < 0n && it.signed;
    let s = (v.n < 0n ? -v.n : v.n).toString();
    const fits = s.length <= it.digits;
    if (check && !fits) return false;
    s = s.padStart(it.digits, "0").slice(-it.digits);
    if (neg && /[1-9]/.test(s)) s = s.slice(0, -1) + "}JKLMNOPQR"[Number(s[s.length - 1])];
    this.setText(ref, s);
    return fits;
  }

  // ----- values -----
  num(e: Expr, line: number): Dec {
    const v = this.value(e, true);
    if (v.k === "num") return v.d;
    if (v.k === "fig" && v.f === "ZERO") return ZERO_DEC;
    if (v.k === "str" && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(v.s.trim())) return decOf(v.s.trim());
    const what = e.k === "ref" ? e.ref.name : v.k === "str" ? `"${v.s}"` : "THIS";
    cerr(line, `${what} IS NOT A NUMBER, SO IT CAN'T BE USED IN A CALCULATION.`);
  }
  value(e: Expr, numeric = false): Val {
    switch (e.k) {
      case "lit":
        return e.lit.k === "num" ? { k: "num", d: e.lit.d, text: e.lit.text } : e.lit.k === "str" ? { k: "str", s: e.lit.s } : { k: "fig", f: e.lit.f, s: e.lit.s };
      case "ref": {
        const ref = this.resolve(e.ref);
        if (ref.item.cat === "numeric") return { k: "num", d: this.readNum(ref, e.ref.line) };
        if (numeric && ref.item.cat === "edited") cerr(e.ref.line, `${ref.item.name} IS AN EDITED FIELD (PIC ${ref.item.pic}), MADE FOR PRINTING. CALCULATE WITH A PIC 9 FIELD.`);
        return { k: "str", s: this.text(ref) };
      }
      case "neg":
        return { k: "num", d: mulDec(this.num(e.e, e.line), { n: -1n, s: 0 }) };
      case "bin": {
        const a = this.num(e.a, e.line);
        const b = this.num(e.b, e.line);
        if (e.op === "+") return { k: "num", d: addDec(a, b) };
        if (e.op === "-") return { k: "num", d: subDec(a, b) };
        if (e.op === "*") return { k: "num", d: mulDec(a, b) };
        if (e.op === "/") return { k: "num", d: divDec(a, b, e.line) };
        return { k: "num", d: powDec(a, b, e.line) };
      }
    }
  }
  // The text a value shows when DISPLAYed
  shown(e: Expr): string {
    if (e.k === "ref") {
      const ref = this.resolve(e.ref);
      const t = this.text(ref);
      // A signed number shows its sign in the last digit on the mainframe; here it's shown as a trailing -
      if (ref.item.cat === "numeric" && ref.item.signed) {
        const negIdx = "}JKLMNOPQR".indexOf(t[t.length - 1]);
        if (negIdx >= 0) return t.slice(0, -1) + negIdx + "-";
      }
      return t;
    }
    const v = this.value(e);
    if (v.k === "num") return v.text ?? decText(v.d);
    if (v.k === "str") return v.s;
    return v.f === "ZERO" ? "0" : v.f === "SPACE" ? " " : v.f === "QUOTE" ? '"' : v.f === "ALL" ? v.s ?? "" : "";
  }

  // ----- MOVE -----
  moveLit(lit: Lit, dest: Ref, line: number) {
    this.moveVal(lit.k === "num" ? { k: "num", d: lit.d, text: lit.text } : lit.k === "str" ? { k: "str", s: lit.s } : { k: "fig", f: lit.f, s: lit.s }, null, dest, line);
  }
  moveVal(v: Val, srcRef: Ref | null, dest: Ref, line: number) {
    const it = dest.item;
    const cat = dest.len !== it.size ? "alnum" : it.cat;
    if (v.k === "fig") {
      const fill = v.f === "ZERO" ? "0" : v.f === "SPACE" ? " " : v.f === "HIGH" ? "ÿ" : v.f === "LOW" ? "\u0000" : v.f === "QUOTE" ? '"' : v.s || " ";
      if (v.f === "ZERO" && (cat === "numeric" || cat === "edited")) return void this.storeNum(dest, ZERO_DEC, false, line);
      if (v.f === "SPACE" && cat === "edited") return this.setText(dest, " ".repeat(dest.len));
      this.setText(dest, fill.repeat(Math.ceil(dest.len / fill.length)).slice(0, dest.len));
      return;
    }
    if (cat === "numeric" || cat === "edited") {
      if (v.k === "num") return void this.storeNum(dest, v.d, false, line);
      // Text into a number: moved as an unsigned whole number. Letters stay letters (and fail later: S0C7)
      if (cat === "edited") {
        const t = v.s.trim();
        if (/^\d+$/.test(t)) return void this.storeNum(dest, decOf(t), false, line);
        return this.setText(dest, v.s.padEnd(dest.len).slice(0, dest.len));
      }
      const intLen = it.digits - it.scale;
      const t = v.s.replace(/\s+$/, "");
      const body = t.length >= intLen ? t.slice(t.length - intLen) : t.padStart(intLen, "0");
      this.setText(dest, body + "0".repeat(it.scale));
      return;
    }
    // Into text (or a group): left-justified, filled with spaces, cut on the right
    let s: string;
    if (v.k === "num") {
      if (srcRef) {
        s = this.text(srcRef);
        const negIdx = "}JKLMNOPQR".indexOf(s[s.length - 1]);
        if (srcRef.item.signed && negIdx >= 0) s = s.slice(0, -1) + negIdx;
      } else s = v.text?.replace(/^[+-]/, "").replace(".", "") ?? decText(v.d);
    } else s = v.s;
    this.setText(dest, s.padEnd(dest.len).slice(0, dest.len));
  }
  move(src: Expr, dest: Ref, line: number) {
    if (src.k === "ref") {
      const sref = this.resolve(src.ref);
      const sIt = sref.item;
      const dcat = dest.len !== dest.item.size ? "alnum" : dest.item.cat;
      if (sIt.cat === "numeric" && (dcat === "numeric" || dcat === "edited")) return void this.storeNum(dest, this.readNum(sref, line), false, line);
      if (sIt.cat === "numeric") return this.moveVal({ k: "num", d: ZERO_DEC }, sref, dest, line);
      if (sIt.cat === "group" || dcat === "group") return this.setText(dest, this.text(sref).padEnd(dest.len).slice(0, dest.len));
      return this.moveVal({ k: "str", s: this.text(sref) }, sref, dest, line);
    }
    this.moveVal(this.value(src), null, dest, line);
  }

  // ----- conditions -----
  compare(a: Val, b: Val): number {
    if (a.k === "fig" && b.k !== "fig") return -this.compare(b, a);
    if (b.k === "fig") {
      if (b.f === "ZERO" && a.k === "num") return cmpDec(a.d, ZERO_DEC);
      const s = a.k === "num" ? a.text ?? decText(a.d) : a.k === "str" ? a.s : "";
      const fill = b.f === "ZERO" ? "0" : b.f === "SPACE" ? " " : b.f === "HIGH" ? "ÿ" : b.f === "LOW" ? "\u0000" : b.s || " ";
      const other = fill.repeat(Math.ceil(Math.max(1, s.length) / fill.length)).slice(0, Math.max(1, s.length));
      return s < other ? -1 : s > other ? 1 : 0;
    }
    if (a.k === "num" && b.k === "num") return cmpDec(a.d, b.d);
    if (a.k === "num" && b.k === "str" && /^\s*[+-]?\d+(\.\d+)?\s*$/.test(b.s)) return cmpDec(a.d, decOf(b.s.trim()));
    if (b.k === "num" && a.k === "str" && /^\s*[+-]?\d+(\.\d+)?\s*$/.test(a.s)) return cmpDec(decOf(a.s.trim()), b.d);
    const x = a.k === "num" ? decText(a.d) : a.k === "str" ? a.s : "";
    const y = b.k === "num" ? decText(b.d) : b.k === "str" ? b.s : "";
    const n = Math.max(x.length, y.length);
    const xs = x.padEnd(n);
    const ys = y.padEnd(n);
    return xs < ys ? -1 : xs > ys ? 1 : 0;
  }
  test(c: Cond): boolean {
    switch (c.k) {
      case "and":
        return this.test(c.a) && this.test(c.b);
      case "or":
        return this.test(c.a) || this.test(c.b);
      case "not":
        return !this.test(c.c);
      case "name": {
        const it = this.find(c.ref);
        if (it.cat !== "cond") {
          cerr(c.ref.line, `${it.name} IS A FIELD, NOT A CONDITION. COMPARE IT: IF ${it.name} = …`);
        }
        const parentRef = this.resolve({ ...c.ref, name: it.parent!.name, quals: [] });
        const pv: Val = parentRef.item.cat === "numeric" ? { k: "num", d: this.readNum(parentRef, c.ref.line) } : { k: "str", s: this.text(parentRef) };
        const lit = (l: Lit): Val => (l.k === "num" ? { k: "num", d: l.d } : l.k === "str" ? { k: "str", s: l.s } : { k: "fig", f: l.f, s: l.s });
        return it.condValues.some(([a, b]) => (b ? this.compare(pv, lit(a)) >= 0 && this.compare(pv, lit(b)) <= 0 : this.compare(pv, lit(a)) === 0));
      }
      case "class": {
        let r: boolean;
        if (c.cls === "NUMERIC") {
          const s = c.a.k === "ref" ? this.text(this.resolve(c.a.ref)) : this.shown(c.a);
          const it = c.a.k === "ref" ? this.find(c.a.ref) : null;
          r = it?.signed ? /^\d*[\d}J-R]$/.test(s) : /^\d+$/.test(s);
        } else if (c.cls === "ALPHABETIC") {
          r = /^[A-Za-z ]*$/.test(this.shown(c.a));
        } else {
          const d = this.num(c.a, c.line);
          r = c.cls === "POSITIVE" ? d.n > 0n : c.cls === "NEGATIVE" ? d.n < 0n : d.n === 0n;
        }
        return c.not ? !r : r;
      }
      case "rel": {
        const r = this.compare(this.value(c.a), this.value(c.b));
        switch (c.op) {
          case "=":
            return r === 0;
          case "<>":
            return r !== 0;
          case ">":
            return r > 0;
          case "<":
            return r < 0;
          case ">=":
            return r >= 0;
          default:
            return r <= 0;
        }
      }
    }
  }

  // ----- statements -----
  run() {
    try {
      this.runRange(0, this.paras.length - 1, true);
    } catch (e) {
      if (!(e instanceof StopRun)) throw e;
    }
  }
  // Run paragraphs from..thru, falling from one into the next, following GO TO
  runRange(from: number, thru: number, main: boolean) {
    let p = from;
    for (;;) {
      try {
        this.execList(this.paras[p].stmts);
      } catch (e) {
        if (e instanceof GoToSignal) {
          p = e.para;
          continue;
        }
        throw e;
      }
      if (p === thru && !main) return;
      p++;
      if (p >= this.paras.length) throw new StopRun(); // the end of the program
    }
  }
  execList(list: Stmt[]) {
    for (const s of list) this.exec(s);
  }
  exec(s: Stmt): void {
    this.step(s.line);
    switch (s.k) {
      case "display": {
        this.write(s.items.map((e) => this.shown(e)).join("") + (s.noAdvancing ? "" : "\n"));
        return;
      }
      case "accept": {
        const ref = this.resolve(s.ref);
        if (s.from) {
          const now = new Date();
          const p2 = (n: number) => String(n).padStart(2, "0");
          const v = s.from === "DATE" ? p2(now.getFullYear() % 100) + p2(now.getMonth() + 1) + p2(now.getDate()) : s.from === "TIME" ? p2(now.getHours()) + p2(now.getMinutes()) + p2(now.getSeconds()) + "00" : s.from === "DAY-OF-WEEK" ? String(((now.getDay() + 6) % 7) + 1) : "";
          if (!v) cerr(s.line, `ACCEPT … FROM ${s.from} ISN'T SUPPORTED. USE DATE, TIME OR DAY-OF-WEEK.`);
          return this.moveVal({ k: "str", s: v }, null, ref, s.line);
        }
        if (this.inPos >= this.inputs.length) abend("U4038", "END OF SYSIN", s.line, "ACCEPT FOUND NO MORE INPUT CARDS.");
        const card = this.inputs[this.inPos++];
        if (ref.item.cat === "numeric" || ref.item.cat === "edited") {
          const t = card.trim();
          if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return void this.storeNum(ref, decOf(t), false, s.line);
        }
        return this.moveVal({ k: "str", s: card }, null, ref, s.line);
      }
      case "move":
        for (const t of s.targets) this.move(s.src, this.resolve(t), s.line);
        return;
      case "arith":
        return this.arith(s);
      case "compute": {
        const v = this.num(s.e, s.line);
        this.storeAll(s.targets.map((t) => ({ t, d: v })), s.size, s.line);
        return;
      }
      case "if":
        return this.execList(this.test(s.c) ? s.then : s.else);
      case "evaluate": {
        const subj = s.subject === "TRUE" || s.subject === "FALSE" ? null : this.value(s.subject);
        for (const w of s.whens) {
          const hit = w.objs.some((o) => {
            if (o === "ANY") return true;
            if ("cond" in o) return this.test(o.cond) === (s.subject === "TRUE");
            const a = this.value(o.a);
            const r = o.thru ? this.compare(subj!, a) >= 0 && this.compare(subj!, this.value(o.thru)) <= 0 : this.compare(subj!, a) === 0;
            return o.not ? !r : r;
          });
          if (hit) return this.execList(w.stmts);
        }
        if (s.other) this.execList(s.other);
        return;
      }
      case "perform":
        return this.perform(s);
      case "goto":
        throw new GoToSignal(s.para);
      case "stop":
        throw new StopRun();
      case "nop":
        return;
      case "initialize":
        for (const r of s.refs) {
          const ref = this.resolve(r);
          this.initialize(ref.item, ref.addr - ref.item.base);
        }
        return;
      case "set":
        for (const r of s.refs) {
          if (s.mode === "TRUE") {
            const it = this.find(r);
            if (it.cat !== "cond") cerr(s.line, `SET … TO TRUE NEEDS A CONDITION NAME (AN 88 LEVEL), NOT ${it.name}.`);
            const parent = this.resolve({ ...r, name: it.parent!.name, quals: [] });
            this.moveLit(it.condValues[0][0], parent, s.line);
            continue;
          }
          const ref = this.resolve(r);
          const v = this.num(s.value!, s.line);
          if (s.mode === "TO") this.storeNum(ref, v, false, s.line);
          else this.storeNum(ref, (s.mode === "UP" ? addDec : subDec)(this.readNum(ref, s.line), v), false, s.line);
        }
        return;
      case "string": {
        const into = this.resolve(s.into);
        let ptr = s.pointer ? Number(rescale(this.readNum(this.resolve(s.pointer), s.line), 0).n) : 1;
        const buf = this.text(into).split("");
        for (const part of s.parts) {
          let t = this.shown(part.e);
          if (part.delim !== "SIZE") {
            const d = this.shown(part.delim);
            const at = t.indexOf(d);
            if (at >= 0) t = t.slice(0, at);
          }
          for (const ch of t) {
            if (ptr > into.len) break;
            buf[ptr - 1] = ch;
            ptr++;
          }
        }
        this.setText(into, buf.join(""));
        if (s.pointer) this.storeNum(this.resolve(s.pointer), { n: BigInt(ptr), s: 0 }, false, s.line);
        return;
      }
      case "open":
        for (const f of s.files) {
          const of = this.fileNamed(f.name, s.line);
          if (of.mode) abend("IGZ0018S", "OPEN ERROR", s.line, `${f.name} IS ALREADY OPEN.`);
          const name = of.sel.assign;
          if (f.mode === "INPUT") {
            if (of.printer) abend("IGZ0018S", "OPEN ERROR", s.line, `${f.name} GOES TO THE PRINTER; IT CAN ONLY BE OPENED FOR OUTPUT.`);
            if (!this.disk.has(name)) abend("IGZ0035S", "OPEN ERROR", s.line, `THERE IS NO FILE ${name} ON THE DISK. FILES THERE: ${[...this.disk.keys()].join(", ")}.`);
          } else if (!of.printer && (f.mode === "OUTPUT" || !this.disk.has(name))) this.disk.set(name, []);
          of.mode = f.mode;
          of.pos = 0;
          of.atEnd = false;
        }
        return;
      case "close":
        for (const n of s.names) {
          const of = this.fileNamed(n, s.line);
          if (!of.mode) abend("IGZ0018S", "CLOSE ERROR", s.line, `${n} ISN'T OPEN.`);
          of.mode = null;
        }
        return;
      case "read": {
        const of = this.fileNamed(s.file, s.line);
        if (of.mode !== "INPUT") abend("IGZ0020S", "READ ERROR", s.line, `${s.file} ISN'T OPEN FOR INPUT. WRITE OPEN INPUT ${s.file} FIRST.`);
        const lines = this.disk.get(of.sel.assign)!;
        if (of.pos >= lines.length) {
          if (of.atEnd) abend("IGZ0020S", "READ ERROR", s.line, `READ AFTER THE END OF ${s.file}. STOP READING WHEN AT END HAPPENS.`);
          of.atEnd = true;
          if (!s.atEnd) abend("IGZ0020S", "READ ERROR", s.line, `${s.file} HAS NO MORE RECORDS, AND THIS READ HAS NO AT END.`);
          return this.execList(s.atEnd);
        }
        const rec = this.recordOf(s.file, s.line);
        const ref: Ref = { item: rec, addr: rec.base, len: rec.size };
        this.setText(ref, lines[of.pos++].padEnd(rec.size).slice(0, rec.size));
        if (s.into) {
          const dest = this.resolve(s.into);
          this.setText(dest, this.text(ref).padEnd(dest.len).slice(0, dest.len));
        }
        if (s.notAtEnd) this.execList(s.notAtEnd);
        return;
      }
      case "write": {
        const rec = this.find(s.rec);
        if (!rec.file) cerr(s.line, `WRITE NEEDS A RECORD FROM THE FILE SECTION, AND ${rec.name} ISN'T ONE. (WRITE THE RECORD, NOT THE FILE.)`);
        const of = this.fileNamed(rec.file, s.line);
        if (of.mode !== "OUTPUT" && of.mode !== "EXTEND") abend("IGZ0020S", "WRITE ERROR", s.line, `${rec.file} ISN'T OPEN FOR OUTPUT. WRITE OPEN OUTPUT ${rec.file} FIRST.`);
        const ref: Ref = { item: rec, addr: rec.base, len: rec.size };
        if (s.from) this.move(s.from, ref, s.line);
        const text = this.text(ref).replace(/\s+$/, "");
        const n = s.page ? 1 : s.lines ? Number(rescale(this.num(s.lines, s.line), 0).n) : 1;
        const out: string[] = [];
        const blanks = Array(Math.max(0, n - 1)).fill("");
        if (s.before) out.push(text, ...blanks);
        else out.push(...blanks, text);
        if (of.printer) this.write(out.map((l) => l + "\n").join(""));
        else {
          const lines = this.disk.get(of.sel.assign)!;
          lines.push(text);
          if (lines.length > 5000) abend("SB37", "OUT OF SPACE", s.line, "THE FILE GOT TOO BIG. CHECK YOUR LOOPS.");
        }
        return;
      }
      case "search": {
        const table = this.find(s.table);
        if (table.occurs < 2 || !table.indexNames.length) cerr(s.line, `SEARCH NEEDS A TABLE WITH OCCURS … INDEXED BY, AND ${table.name} HAS ${table.occurs < 2 ? "NO OCCURS" : "NO INDEXED BY"}.`);
        const idx = this.resolve({ name: table.indexNames[0], quals: [], subs: [], refMod: null, line: s.line });
        for (;;) {
          this.step(s.line);
          const k = Number(rescale(this.readNum(idx, s.line), 0).n);
          if (k < 1 || k > table.occurs) {
            if (s.atEnd) this.execList(s.atEnd);
            return;
          }
          const hit = s.whens.find((w) => this.test(w.c));
          if (hit) return this.execList(hit.stmts);
          this.storeNum(idx, { n: BigInt(k + 1), s: 0 }, false, s.line);
        }
      }
      case "inspect": {
        const ref = this.resolve(s.ref);
        let t = this.text(ref);
        for (const tl of s.tallying) {
          let n = 0;
          if (tl.what === "CHARACTERS") n = t.length;
          else {
            const pat = this.shown(tl.e!);
            if (!pat) continue;
            if (tl.what === "ALL") for (let k = t.indexOf(pat); k >= 0; k = t.indexOf(pat, k + pat.length)) n++;
            else for (let k = 0; t.startsWith(pat, k); k += pat.length) n++;
          }
          const cref = this.resolve(tl.counter);
          this.storeNum(cref, addDec(this.readNum(cref, s.line), { n: BigInt(n), s: 0 }), false, s.line);
        }
        for (const rp of s.replacing) {
          const to = this.shown(rp.to);
          if (rp.what === "CHARACTERS") {
            t = to[0].repeat(t.length);
            continue;
          }
          const from = this.shown(rp.from!);
          if (from.length !== to.length) cerr(s.line, `INSPECT … REPLACING NEEDS THE SAME LENGTH: "${from}" HAS ${from.length} CHARACTERS, "${to}" HAS ${to.length}.`);
          if (rp.what === "ALL") t = t.split(from).join(to);
          else if (rp.what === "FIRST") t = t.replace(from, to);
          else {
            let k = 0;
            while (t.startsWith(from, k)) {
              t = t.slice(0, k) + to + t.slice(k + from.length);
              k += from.length;
            }
          }
        }
        this.setText(ref, t);
        return;
      }
    }
  }

  fileNamed(name: string, line: number): OpenFile {
    const of = this.files.get(name);
    if (!of) cerr(line, `THERE IS NO FILE ${name}. DECLARE IT WITH SELECT ${name} ASSIGN TO … AND AN FD.`);
    return of;
  }
  recordOf(file: string, line: number): Item {
    const rec = this.items.find((it) => it.file === file && !it.parent);
    if (!rec) cerr(line, `THE FD FOR ${file} HAS NO RECORD. ADD AN 01 RECORD UNDER IT.`);
    return rec;
  }

  initialize(it: Item, offset: number) {
    if (it.cat === "cond") return;
    const kids = it.children.filter((c) => c.cat !== "cond");
    if (kids.length) {
      for (const c of kids) for (let k = 0; k < c.occurs; k++) this.initialize(c, offset + k * c.size);
      return;
    }
    const ref: Ref = { item: it, addr: it.base + offset, len: it.size };
    if (it.cat === "numeric" || it.cat === "edited") this.storeNum(ref, ZERO_DEC, false, it.line);
    else this.setText(ref, " ".repeat(it.size));
  }

  storeAll(results: { t: Target; d: Dec }[], size: SizePhrase, line: number) {
    const check = !!(size.onError || size.notOnError);
    let error = false;
    for (const { t, d } of results) {
      const ref = this.resolve(t.ref);
      if (!this.storeNum(ref, d, t.rounded, line, check)) error = true;
    }
    if (error && size.onError) this.execList(size.onError);
    else if (!error && size.notOnError) this.execList(size.notOnError);
  }

  arith(s: Stmt & { k: "arith" }) {
    const vals = s.operands.map((e) => this.num(e, s.line));
    const sum = () => vals.reduce(addDec, ZERO_DEC);
    const results: { t: Target; d: Dec }[] = [];
    let remainder: Dec | null = null;
    const cur = (t: Target) => this.readNum(this.resolve(t.ref), s.line);
    switch (s.verb) {
      case "ADD":
        if (s.giving.length) for (const g of s.giving) results.push({ t: g, d: sum() });
        else for (const t of s.to) results.push({ t, d: addDec(cur(t), sum()) });
        break;
      case "SUBTRACT":
        if (s.giving.length) {
          const from = vals.pop()!;
          const total = vals.reduce(addDec, ZERO_DEC);
          for (const g of s.giving) results.push({ t: g, d: subDec(from, total) });
        } else for (const t of s.to) results.push({ t, d: subDec(cur(t), sum()) });
        break;
      case "MULTIPLY":
        if (s.giving.length) for (const g of s.giving) results.push({ t: g, d: mulDec(vals[0], vals[1]) });
        else for (const t of s.to) results.push({ t, d: mulDec(cur(t), vals[0]) });
        break;
      case "DIVIDE": {
        // DIVIDE A INTO B: B / A. DIVIDE A BY B: A / B
        if (s.giving.length) {
          const [dividend, divisor] = s.byFirst ? [vals[0], vals[1]] : [vals[1], vals[0]];
          const q = divDec(dividend, divisor, s.line);
          for (const g of s.giving) results.push({ t: g, d: q });
          if (s.remainder) {
            const g = this.resolve(s.giving[0].ref).item;
            const qt = rescale(q, g.scale);
            remainder = subDec(dividend, mulDec(qt, divisor));
          }
        } else for (const t of s.to) results.push({ t, d: divDec(cur(t), vals[0], s.line) });
        break;
      }
    }
    this.storeAll(results, s.size, s.line);
    if (s.remainder && remainder) this.storeNum(this.resolve(s.remainder.ref), remainder, false, s.line);
  }

  perform(s: Stmt & { k: "perform" }) {
    if (++this.depth > 200) abend("S0C4", "PERFORM NESTED TOO DEEP", s.line, "A PARAGRAPH PERFORMS ITSELF (OR THE PERFORMS NEVER RETURN).");
    try {
      const once = () => {
        if (s.body) this.execList(s.body);
        else this.runRange(s.para!, s.thru ?? s.para!, false);
      };
      if (s.varying.length) {
        const loop = (level: number) => {
          const v = s.varying[level];
          const ref = this.resolve(v.ref);
          this.storeNum(ref, this.num(v.from, s.line), false, s.line);
          for (;;) {
            this.step(s.line);
            if (this.test(v.until)) break;
            if (level + 1 < s.varying.length) loop(level + 1);
            else once();
            const r2 = this.resolve(v.ref);
            this.storeNum(r2, addDec(this.readNum(r2, s.line), this.num(v.by, s.line)), false, s.line);
          }
        };
        loop(0);
        return;
      }
      if (s.until) {
        for (;;) {
          this.step(s.line);
          if (!s.testAfter && this.test(s.until)) break;
          once();
          if (s.testAfter && this.test(s.until)) break;
        }
        return;
      }
      const n = s.times ? Number(rescale(this.num(s.times, s.line), 0).n) : 1;
      for (let k = 0; k < n; k++) once();
    } finally {
      this.depth--;
    }
  }
}

// inputs: the cards for ACCEPT, one per ACCEPT
export function runCobol(source: string, inputs: (number | string)[] = []): RunResult {
  let m: Machine | null = null;
  try {
    const toks = tokenize(source);
    if (toks.length === 0) return { output: "", error: "IKF ERROR, LINE 1: THE PROGRAM IS EMPTY. START WITH IDENTIFICATION DIVISION." };
    const prog = new Parser(toks).program();
    m = new Machine(prog.items, prog.paras, inputs.map(String), prog.selects);
    m.run();
    return { output: m.out, error: null };
  } catch (e) {
    if (e instanceof CompileError) return { output: "", error: e.message };
    if (e instanceof Abend) return { output: m?.out ?? "", error: e.message };
    if (e instanceof RangeError) return { output: m?.out ?? "", error: "ABEND S0C4 (STACK OVERFLOW): THE PERFORMS NEVER RETURN." };
    if (e instanceof GoToSignal) return { output: m?.out ?? "", error: "ABEND: GO TO OUTSIDE A PARAGRAPH." };
    throw e;
  }
}

// For the PIC exercise: what a value looks like in a picture
export function showInPicture(picText: string, value: string): string {
  const it: Item = { name: "X", level: 1, line: 1, parent: null, children: [], pic: null, cat: "group", digits: 0, scale: 0, signed: false, size: 0, occurs: 1, base: 0, value: null, condValues: [], redefines: null, indexNames: [] };
  describePic(it, picText, 1);
  if (it.cat === "edited") return editNumber(it.pic!, decOf(value), it.digits, it.scale);
  if (it.cat === "numeric") {
    const v = rescale(decOf(value), it.scale);
    return (v.n < 0n ? -v.n : v.n).toString().padStart(it.digits, "0").slice(-it.digits);
  }
  return value.padEnd(it.size).slice(0, it.size);
}
