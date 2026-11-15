// A FORTRAN IV interpreter, styled after programs run on an IBM 704 / 7090 from a card deck.
//
// What it understands:
// - Cards: "C" or "*" in column 1 is a comment. A label (statement number) comes first, then the statement.
//   A character other than a blank or 0 in column 6 continues the previous card.
//   Columns don't have to be exact here: "10 X = 1" works as well as "   10 X = 1".
// - Blanks don't matter outside of text, like on the real compilers: GO TO = GOTO.
// - Types: names starting with I to N are INTEGER, all others REAL, unless declared with INTEGER, REAL,
//   DOUBLE PRECISION, COMPLEX or LOGICAL. REAL keeps about 7 digits (single precision), DOUBLE PRECISION 16.
//   Text is kept in INTEGER variables, 4 characters each, like on the IBM System/360 (A format, nH, 'text').
// - Statements: assignment, GO TO, computed GO TO, arithmetic IF, logical IF, DO / CONTINUE,
//   DIMENSION, INTEGER, REAL, DATA, WRITE / PRINT, READ, FORMAT, STOP, PAUSE, END,
//   SUBROUTINE, CALL, FUNCTION, RETURN, COMMON and statement functions like F(X) = X ** 2.
// - FORMAT: Iw, Fw.d, Ew.d, Dw.d, Lw, Aw, nX, 'text', nHtext, /, repeat counts and groups like 3(I4, F6.2).
// - The first character of every printed line is carriage control, like on the line printer:
//   " " = normal, "0" = an empty line first, "1" = a new page. It is not printed.

export type FortranRun = { output: string; error: string | null };

const MAX_STEPS = 200000;

class FortranError extends Error {}
const fail = (message: string): never => {
  throw new FortranError(message);
};

// ---------- Values and storage ----------

type Kind = "I" | "R" | "L" | "D" | "C"; // integer, real, logical, double precision, complex
// A complex variable keeps its imaginary part in im
type Ref = { get: () => number; set: (v: number) => void; im?: number };
type ArrayObj = { kind: Kind; dims: number[]; data: number[] };

const cell = (value = 0): Ref => {
  let v = value;
  return { get: () => v, set: (x) => (v = x) };
};

// ---------- Cards ----------

type Statement = { label: number | null; text: string; raw: string; card: number };

// Blanks are ignored in FORTRAN, except inside 'text' and nH text
function squeeze(text: string): string {
  let out = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted;
    if (!quoted && (ch === " " || ch === "\t")) continue;
    out += quoted ? ch : ch.toUpperCase();
  }
  return out;
}

function readCards(source: string): Statement[] {
  const statements: Statement[] = [];
  source.split("\n").forEach((line, index) => {
    const raw = line.replace(/\t/g, "      ").replace(/\s+$/, "");
    if (raw.trim() === "") return;
    if (/^[Cc*](\s|$)/.test(raw) || /^[Cc*]$/.test(raw)) return; // comment card
    if (/^!/.test(raw.trim())) return;
    // Continuation: columns 1-5 blank, column 6 not blank and not 0
    if (raw.length > 6 && /^ {5}[^ 0]/.test(raw) && statements.length > 0 && /^ {5}[&$+*1-9]/.test(raw)) {
      const prev = statements[statements.length - 1];
      prev.raw += raw.slice(6);
      prev.text = squeeze(prev.raw);
      return;
    }
    const m = raw.match(/^\s*(\d{1,5})\s+(.*)$/);
    const label = m ? parseInt(m[1], 10) : null;
    const body = m ? m[2] : raw.trim();
    statements.push({ label, text: squeeze(body), raw: body, card: index + 1 });
  });
  return statements;
}

// Split at top-level commas (not inside brackets or quotes)
function splitTop(text: string, sep = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of text) {
    if (ch === "'") quoted = !quoted;
    if (!quoted) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === sep && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

// The index of the bracket that closes the one at position open
function closing(text: string, open: number): number {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth++;
    if (ch === ")" && --depth === 0) return i;
  }
  return -1;
}

// ---------- Text in variables ----------
// Like on the IBM System/360, one INTEGER word holds 4 characters (8 bits each).

const CHARS_PER_WORD = 4;
function encodeText(text: string): number {
  const t = text.slice(0, CHARS_PER_WORD).padEnd(CHARS_PER_WORD, " ");
  let n = 0;
  for (const ch of t) n = n * 256 + (ch.charCodeAt(0) & 255);
  return n;
}
function decodeText(n: number): string {
  let v = Math.trunc(Math.abs(n));
  let out = "";
  for (let k = 0; k < CHARS_PER_WORD; k++) {
    const c = v % 256;
    out = (c >= 32 && c < 127 ? String.fromCharCode(c) : " ") + out;
    v = Math.floor(v / 256);
  }
  return out;
}
// 'TEXT' or 4HTEXT in a DATA statement
function textConstant(value: string): string | null {
  let m = value.match(/^'(.*)'$/);
  if (m) return m[1].replace(/''/g, "'");
  m = value.match(/^(\d+)H(.*)$/);
  if (m) return m[2].padEnd(parseInt(m[1], 10), " ").slice(0, parseInt(m[1], 10));
  return null;
}
// REAL variables keep single precision (about 7 digits)
const single = (v: number) => Math.fround(v);

// ---------- FORMAT ----------

type FItem =
  | { t: "I"; w: number }
  | { t: "D"; w: number; d: number }
  | { t: "L"; w: number }
  | { t: "A"; w: number }
  | { t: "F"; w: number; d: number }
  | { t: "E"; w: number; d: number }
  | { t: "X"; n: number }
  | { t: "TEXT"; s: string }
  | { t: "SLASH" }
  | { t: "GROUP"; n: number; items: FItem[] };

function parseFormat(rawSpec: string, where: string): FItem[] {
  const items: FItem[] = [];
  let i = 0;
  const s = rawSpec;
  const err = () => fail(`*ERROR* BAD FORMAT ${where}`);
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === ",") {
      i++;
      continue;
    }
    if (ch === "/") {
      items.push({ t: "SLASH" });
      i++;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let text = "";
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") (text += "'"), (j += 2);
        else if (s[j] === "'") break;
        else text += s[j++];
      }
      if (j >= s.length) err();
      items.push({ t: "TEXT", s: text });
      i = j + 1;
      continue;
    }
    // A number in front: repeat count, nX, or nH
    let num = "";
    while (i < s.length && /\d/.test(s[i])) num += s[i++];
    while (s[i] === " ") i++;
    const n = num ? parseInt(num, 10) : 1;
    const code = (s[i] ?? "").toUpperCase();
    if (code === "H") {
      if (!num) err();
      items.push({ t: "TEXT", s: s.slice(i + 1, i + 1 + n) });
      i += 1 + n;
      continue;
    }
    if (code === "X") {
      items.push({ t: "X", n });
      i++;
      continue;
    }
    if (code === "(") {
      const end = closing(s, i);
      if (end < 0) err();
      items.push({ t: "GROUP", n, items: parseFormat(s.slice(i + 1, end), where) });
      i = end + 1;
      continue;
    }
    const m = s.slice(i).match(/^([IFEDLA])\s*(\d+)(?:\s*\.\s*(\d+))?/i);
    if (!m) err();
    const kind = m![1].toUpperCase() as "I" | "F" | "E" | "D" | "L" | "A";
    const w = parseInt(m![2], 10);
    const d = m![3] !== undefined ? parseInt(m![3], 10) : 0;
    const whole = kind === "I" || kind === "L" || kind === "A";
    if (!whole && m![3] === undefined) fail(`*ERROR* ${kind}${w} NEEDS DECIMALS, LIKE ${kind}${w}.2, ${where}`);
    for (let k = 0; k < n; k++) items.push(whole ? { t: kind as "I" | "L" | "A", w } : { t: kind as "F" | "E" | "D", w, d });
    i += m![0].length;
  }
  return items;
}

const stars = (w: number) => "*".repeat(w);

function formatI(value: number, w: number) {
  const text = String(Math.trunc(value));
  return text.length > w ? stars(w) : text.padStart(w);
}

function formatF(value: number, w: number, d: number) {
  let text = Math.abs(value).toFixed(d);
  if (d === 0) text += ".";
  const negative = value < 0 && Number(text.replace(".", "")) !== 0;
  let full = (negative ? "-" : "") + text;
  if (full.length > w && text.startsWith("0.")) full = (negative ? "-" : "") + text.slice(1); // drop the leading 0
  return full.length > w ? stars(w) : full.padStart(w);
}

function formatE(value: number, w: number, d: number) {
  if (value === 0) return (`0.${"0".repeat(d)}E+00`).padStart(w);
  let exp = Math.floor(Math.log10(Math.abs(value))) + 1;
  let mant = Math.abs(value) / Math.pow(10, exp);
  if (Number(mant.toFixed(d)) >= 1) (mant /= 10), exp++;
  const text = `${value < 0 ? "-" : ""}0.${mant.toFixed(d).slice(2)}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  return text.length > w ? stars(w) : text.padStart(w);
}

function formatA(value: number, w: number) {
  const text = decodeText(value);
  return w >= CHARS_PER_WORD ? text.padStart(w) : text.slice(0, w);
}

// Turn a printed record into a line, using its carriage control character
function printLine(record: string): string {
  const control = record[0] ?? " ";
  const rest = record.slice(1).replace(/\s+$/, "");
  if (control === "0") return "\n" + rest;
  if (control === "1") return "\n" + rest; // a new page: shown as a blank line
  return rest;
}

// ---------- The interpreter ----------

type Unit = {
  kind: "MAIN" | "SUBROUTINE" | "FUNCTION";
  name: string;
  params: string[];
  resultKind?: Kind;
  statements: Statement[];
  labels: Map<number, number>; // label -> statement index
  formats: Map<number, FItem[]>;
  declared: Map<string, Kind>;
  dims: Map<string, string[]>; // array name -> dimension expressions
  commons: { block: string; names: string[] }[];
  stmtFns: Map<string, { params: string[]; expr: string }>;
  data: { names: string[]; values: string[] }[];
};

type Frame = {
  unit: Unit;
  vars: Map<string, Ref>;
  arrays: Map<string, ArrayObj>;
};

const INTRINSICS = new Set([
  "SQRT", "ABS", "IABS", "FLOAT", "REAL", "INT", "IFIX", "MOD", "AMOD", "SIN", "COS", "TAN", "ATAN",
  "EXP", "ALOG", "ALOG10", "LOG", "LOG10", "MAX", "MIN", "MAX0", "MIN0", "AMAX1", "AMIN1", "SIGN", "ISIGN", "NINT",
  "DBLE", "SNGL", "DSQRT", "DABS", "DSIN", "DCOS", "DEXP", "DLOG", "DATAN",
  "CMPLX", "AIMAG", "CABS", "CONJG", "CSQRT",
]);
const DOUBLE_RESULT = new Set(["DBLE", "DSQRT", "DABS", "DSIN", "DCOS", "DEXP", "DLOG", "DATAN"]);
const INTEGER_RESULT = new Set(["IABS", "INT", "IFIX", "MOD", "MAX0", "MIN0", "ISIGN", "NINT"]);

const DECL = /^(INTEGER|REAL|DOUBLEPRECISION|LOGICAL|COMPLEX)(?!FUNCTION)/;
// REALRT = 1.0 starts like REAL RT, but the = makes it an assignment
const isDecl = (t: string) => DECL.test(t) && !t.includes("=");
const KIND_OF: Record<string, Kind> = { INTEGER: "I", REAL: "R", DOUBLEPRECISION: "D", LOGICAL: "L", COMPLEX: "C" };

export function runFortran(source: string, inputs: (string | number)[] = []): FortranRun {
  const lines: string[] = [];
  let record = ""; // the line being built
  const cards = inputs.map(String);
  let steps = 0;
  let unitsRef: Unit[] = [];
  let commonsRef = new Map<string, Ref[]>();

  try {
    const units = buildUnits(readCards(source));
    const main = units.find((u) => u.kind === "MAIN");
    if (!main || main.statements.length === 0) fail("*ERROR* NO MAIN PROGRAM");
    const commons = new Map<string, Ref[]>();
    unitsRef = units;
    commonsRef = commons;
    const frame = makeFrame(main!, commons, new Map());
    try {
      execute(frame, units, commons);
    } catch (e) {
      if (!(e instanceof StopSignal)) throw e; // STOP: the job ended normally
    }
    return { output: lines.map((l) => l + "\n").join(""), error: null };
  } catch (e) {
    if (e instanceof FortranError) return { output: lines.map((l) => l + "\n").join(""), error: e.message };
    if (e instanceof RangeError) return { output: lines.map((l) => l + "\n").join(""), error: "*ERROR* TOO MANY CALLS INSIDE EACH OTHER" };
    throw e;
  }

  // ----- Units -----

  function buildUnits(statements: Statement[]): Unit[] {
    const units: Unit[] = [];
    let current: Unit | null = null;
    const newUnit = (kind: Unit["kind"], name: string, params: string[], resultKind?: Kind): Unit => ({
      kind, name, params, resultKind, statements: [], labels: new Map(), formats: new Map(),
      declared: new Map(resultKind ? [[name, resultKind]] : []), dims: new Map(), commons: [], stmtFns: new Map(), data: [],
    });
    for (const st of statements) {
      const t = st.text;
      let m;
      if ((m = t.match(/^SUBROUTINE([A-Z][A-Z0-9]*)(?:\((.*)\))?$/))) {
        current = newUnit("SUBROUTINE", m[1], m[2] ? m[2].split(",") : []);
        units.push(current);
        continue;
      }
      if ((m = t.match(/^(INTEGER|REAL|LOGICAL|DOUBLEPRECISION|COMPLEX)?FUNCTION([A-Z][A-Z0-9]*)\((.*)\)$/))) {
        const kind: Kind = m[1] ? KIND_OF[m[1]] : /^[I-N]/.test(m[2]) ? "I" : "R";
        current = newUnit("FUNCTION", m[2], m[3].split(","), kind);
        units.push(current);
        continue;
      }
      if (!current) {
        current = newUnit("MAIN", "MAIN", []);
        units.push(current);
      }
      if (st.label !== null) {
        if (current.labels.has(st.label)) fail(`*ERROR* LABEL ${st.label} USED TWICE (CARD ${st.card})`);
        current.labels.set(st.label, current.statements.length);
      }
      // Declarations are collected now; FORMAT is parsed from the raw card (blanks in text count)
      if (/^FORMAT\(/.test(t)) {
        if (st.label === null) fail(`*ERROR* FORMAT NEEDS A LABEL (CARD ${st.card})`);
        const rawStart = st.raw.indexOf("(");
        const rawEnd = st.raw.lastIndexOf(")");
        current.formats.set(st.label!, parseFormat(st.raw.slice(rawStart + 1, rawEnd), `(CARD ${st.card})`));
      } else if (/^DIMENSION/.test(t)) {
        declareArrays(current, t.slice(9), null, st);
      } else if (isDecl(t) && (m = t.match(DECL))) {
        const kind = KIND_OF[m[1]];
        const names = declareArrays(current, t.slice(m[1].length), kind, st);
        if (kind === "C" && names.some((n) => current!.dims.has(n))) fail(`*ERROR* COMPLEX ARRAYS AREN'T SUPPORTED HERE: USE TWO REAL ARRAYS (CARD ${st.card})`);
      } else if ((m = t.match(/^COMMON(.*)$/))) {
        const rest = m[1];
        const named = rest.match(/^\/([A-Z0-9]*)\/(.*)$/);
        const block = named ? named[1] : "";
        const list = named ? named[2] : rest;
        current.commons.push({ block, names: splitTop(list).map((n) => declareArrays(current!, n, null, st)[0]) });
      } else if ((m = t.match(/^DATA(.*)$/)) && /\//.test(t)) {
        // DATA A, B /1.0, 2.0/, C /3.0/: one or more groups of names and values
        let rest = m[1];
        while (rest !== "") {
          const parts = rest.match(/^([^/]+)\/([^/]*)\/,?/);
          if (!parts) fail(`*ERROR* BAD DATA STATEMENT (CARD ${st.card})`);
          const values: string[] = [];
          for (const v of splitTop(parts![2])) {
            const rep = v.match(/^(\d+)\*(.+)$/);
            if (rep) for (let k = 0; k < parseInt(rep[1], 10); k++) values.push(rep[2]);
            else values.push(v);
          }
          current.data.push({ names: splitTop(parts![1]), values });
          rest = rest.slice(parts![0].length);
        }
      }
      current.statements.push(st);
    }
    // Statement functions: F(X) = ... before the first executable statement, F not an array
    for (const unit of units) {
      for (const st of unit.statements) {
        const m = st.text.match(/^([A-Z][A-Z0-9]*)\(([A-Z][A-Z0-9]*(?:,[A-Z][A-Z0-9]*)*)\)=(.+)$/);
        if (m && !unit.dims.has(m[1]) && !INTRINSICS.has(m[1])) unit.stmtFns.set(m[1], { params: m[2].split(","), expr: m[3] });
      }
    }
    for (const unit of units) {
      const last = unit.statements[unit.statements.length - 1];
      if (!last || last.text !== "END") fail(`*ERROR* ${unit.kind === "MAIN" ? "THE PROGRAM" : unit.name} NEEDS AN END CARD AT THE END`);
    }
    return units;
  }

  // "A(10), B, C(3,4)" -> remembers types and dimensions, returns the names
  function declareArrays(unit: Unit, list: string, kind: Kind | null, st: Statement): string[] {
    return splitTop(list).map((item) => {
      const m = item.match(/^([A-Z][A-Z0-9]*)(?:\((.*)\))?$/);
      if (!m) fail(`*ERROR* BAD DECLARATION "${item}" (CARD ${st.card})`);
      if (kind) unit.declared.set(m![1], kind);
      if (m![2]) unit.dims.set(m![1], splitTop(m![2]));
      return m![1];
    });
  }

  function kindOf(unit: Unit, name: string): Kind {
    return unit.declared.get(name) ?? (/^[I-N]/.test(name) ? "I" : "R");
  }

  // A new set of variables for a unit. bound: parameters passed in by the caller.
  function makeFrame(unit: Unit, commons: Map<string, Ref[]>, bound: Map<string, Ref | ArrayObj>): Frame {
    const frame: Frame = { unit, vars: new Map(), arrays: new Map() };
    for (const [name, value] of bound) {
      if ("data" in value) frame.arrays.set(name, value);
      else frame.vars.set(name, value);
    }
    for (const { block, names } of unit.commons) {
      const cells = commons.get(block) ?? [];
      names.forEach((name, i) => {
        if (unit.dims.has(name)) fail("*ERROR* ARRAYS IN COMMON AREN'T SUPPORTED HERE");
        if (!cells[i]) cells[i] = cell();
        frame.vars.set(name, cells[i]);
      });
      commons.set(block, cells);
    }
    for (const [name, dimExprs] of unit.dims) {
      if (frame.arrays.has(name)) continue;
      const dims = dimExprs.map((e) => Math.trunc(evaluate(frame, e).v));
      if (dims.some((d) => d < 1 || d > 100000)) fail(`*ERROR* BAD SIZE FOR ARRAY ${name}`);
      frame.arrays.set(name, { kind: kindOf(unit, name), dims, data: new Array(dims.reduce((a, b) => a * b, 1)).fill(0) });
    }
    for (const { names, values } of unit.data) {
      let k = 0;
      for (const name of names) {
        const arr = frame.arrays.get(name);
        const targets = arr ? arr.data.map((_, idx) => idx) : [null];
        for (const idx of targets) {
          if (k >= values.length) fail("*ERROR* DATA HAS FEWER VALUES THAN NAMES");
          const raw = values[k++];
          const text = textConstant(raw);
          const kind = arr ? arr.kind : kindOf(unit, name);
          let v = text !== null ? encodeText(text) : raw === ".TRUE." ? 1 : raw === ".FALSE." ? 0 : parseFloat(raw.replace(/D/, "E"));
          if (text === null) v = kind === "I" ? Math.trunc(v) : kind === "R" ? single(v) : v;
          if (arr) arr.data[idx!] = v;
          else variable(frame, name).set(v);
        }
      }
    }
    return frame;
  }

  function variable(frame: Frame, name: string): Ref {
    let ref = frame.vars.get(name);
    if (!ref) {
      ref = cell();
      frame.vars.set(name, ref);
    }
    return ref;
  }

  function element(frame: Frame, arr: ArrayObj, name: string, indexExprs: string[]): Ref {
    if (indexExprs.length !== arr.dims.length) fail(`*ERROR* ${name} NEEDS ${arr.dims.length} INDEX${arr.dims.length > 1 ? "ES" : ""}`);
    let offset = 0;
    let scale = 1;
    indexExprs.forEach((e, k) => {
      const i = Math.trunc(evaluate(frame, e).v);
      if (i < 1 || i > arr.dims[k]) fail(`*ERROR* ${name}(${indexExprs.join(",")}) IS OUTSIDE THE ARRAY (1 TO ${arr.dims[k]})`);
      offset += (i - 1) * scale;
      scale *= arr.dims[k];
    });
    return { get: () => arr.data[offset], set: (v) => (arr.data[offset] = v) };
  }

  // Where an assignment or READ stores its value
  function target(frame: Frame, text: string): { ref: Ref; kind: Kind } {
    const m = text.match(/^([A-Z][A-Z0-9]*)(?:\((.*)\))?$/);
    if (!m) fail(`*ERROR* CAN'T STORE INTO "${text}"`);
    const name = m![1];
    const arr = frame.arrays.get(name);
    if (m![2] !== undefined) {
      if (!arr) fail(`*ERROR* ${name} IS NOT AN ARRAY. DECLARE IT WITH DIMENSION ${name}(…)`);
      return { ref: element(frame, arr!, name, splitTop(m![2])), kind: arr!.kind };
    }
    if (arr) fail(`*ERROR* ${name} IS AN ARRAY. SAY WHICH ELEMENT, LIKE ${name}(1)`);
    return { ref: variable(frame, name), kind: kindOf(frame.unit, name) };
  }

  function store(t: { ref: Ref; kind: Kind }, value: number | Val) {
    // A plain number (from READ or a DO loop) is exact; a REAL value only brings its 7 digits along
    const val: Val = typeof value === "number" ? { v: value, k: "D" } : value;
    const v = val.v;
    if (t.kind === "C") {
      t.ref.set(single(v));
      t.ref.im = single(val.im ?? 0);
      return;
    }
    t.ref.set(t.kind === "I" ? Math.trunc(v) : t.kind === "R" || val.k === "R" || val.k === "C" ? single(v) : v);
  }

  // ----- Expressions -----

  type Val = { v: number; k: Kind; im?: number };
  function im(a: Val) {
    return a.k === "C" ? a.im ?? 0 : 0;
  }

  function evaluate(frame: Frame, text: string): Val {
    let pos = 0;
    const s = text;
    const peek = (str: string) => s.startsWith(str, pos);
    const eat = (str: string) => (peek(str) ? ((pos += str.length), true) : false);

    function orExpr(): Val {
      let left = andExpr();
      while (eat(".OR.")) {
        const right = andExpr();
        left = { v: left.v || right.v ? 1 : 0, k: "L" };
      }
      return left;
    }
    function andExpr(): Val {
      let left = notExpr();
      while (eat(".AND.")) {
        const right = notExpr();
        left = { v: left.v && right.v ? 1 : 0, k: "L" };
      }
      return left;
    }
    function notExpr(): Val {
      if (eat(".NOT.")) return { v: notExpr().v ? 0 : 1, k: "L" };
      return relExpr();
    }
    function relExpr(): Val {
      const left = addExpr();
      for (const op of [".EQ.", ".NE.", ".LT.", ".LE.", ".GT.", ".GE."]) {
        if (eat(op)) {
          const r = addExpr().v;
          const l = left.v;
          const res = op === ".EQ." ? l === r : op === ".NE." ? l !== r : op === ".LT." ? l < r : op === ".LE." ? l <= r : op === ".GT." ? l > r : l >= r;
          return { v: res ? 1 : 0, k: "L" };
        }
      }
      return left;
    }
    const mixed = (a: Val, b: Val): Kind =>
      a.k === "C" || b.k === "C" ? "C" : a.k === "D" || b.k === "D" ? "D" : a.k === "I" && b.k === "I" ? "I" : "R";
    // Complex arithmetic: (a + bi) op (c + di)
    const complexOp = (op: string, a: Val, b: Val): Val => {
      const [ar, ai, br, bi] = [a.v, im(a), b.v, im(b)];
      if (op === "+") return { v: ar + br, k: "C", im: ai + bi };
      if (op === "-") return { v: ar - br, k: "C", im: ai - bi };
      if (op === "*") return { v: ar * br - ai * bi, k: "C", im: ar * bi + ai * br };
      const d = br * br + bi * bi;
      if (d === 0) fail("*ERROR* DIVISION BY ZERO");
      return { v: (ar * br + ai * bi) / d, k: "C", im: (ai * br - ar * bi) / d };
    };
    function addExpr(): Val {
      let left: Val;
      if (eat("-")) {
        const v = mulExpr();
        left = { v: -v.v, k: v.k, im: v.k === "C" ? -im(v) : undefined };
      } else {
        eat("+");
        left = mulExpr();
      }
      while (true) {
        if (eat("+")) {
          const r = mulExpr();
          left = mixed(left, r) === "C" ? complexOp("+", left, r) : { v: left.v + r.v, k: mixed(left, r) };
        } else if (peek("-")) {
          pos++;
          const r = mulExpr();
          left = mixed(left, r) === "C" ? complexOp("-", left, r) : { v: left.v - r.v, k: mixed(left, r) };
        } else return left;
      }
    }
    function mulExpr(): Val {
      let left = powExpr();
      while (true) {
        if (peek("*") && !peek("**")) {
          pos++;
          const r = powExpr();
          left = mixed(left, r) === "C" ? complexOp("*", left, r) : { v: left.v * r.v, k: mixed(left, r) };
        } else if (eat("/")) {
          const r = powExpr();
          if (mixed(left, r) === "C") {
            left = complexOp("/", left, r);
            continue;
          }
          if (r.v === 0) fail("*ERROR* DIVISION BY ZERO");
          const k = mixed(left, r);
          left = { v: k === "I" ? Math.trunc(left.v / r.v) : left.v / r.v, k };
        } else return left;
      }
    }
    function powExpr(): Val {
      const base = unary();
      if (eat("**")) {
        const exp = powExpr(); // right to left
        if (base.k === "C") {
          if (exp.k !== "I" || exp.v < 0) fail("*ERROR* A COMPLEX NUMBER CAN ONLY BE RAISED TO A POSITIVE WHOLE POWER HERE");
          let r: Val = { v: 1, k: "C", im: 0 };
          for (let n = 0; n < exp.v; n++) r = complexOp("*", r, base);
          return r;
        }
        const k = mixed(base, exp);
        if (base.v < 0 && exp.k === "R") fail("*ERROR* NEGATIVE NUMBER TO A REAL POWER");
        const v = Math.pow(base.v, exp.v);
        return { v: k === "I" ? Math.trunc(v) : v, k };
      }
      return base;
    }
    function unary(): Val {
      if (eat("-")) {
        const v = unary();
        return { v: -v.v, k: v.k, im: v.k === "C" ? -im(v) : undefined };
      }
      if (eat("+")) return unary();
      return primary();
    }
    function primary(): Val {
      if (eat("(")) {
        const v = orExpr();
        if (!eat(")")) fail(`*ERROR* MISSING ) IN "${text}"`);
        return v;
      }
      if (eat(".TRUE.")) return { v: 1, k: "L" };
      if (eat(".FALSE.")) return { v: 0, k: "L" };
      // Numbers: 12 is INTEGER, 12. / 1.5 / 1E3 are REAL. Careful with 1.EQ.2
      const num = s.slice(pos).match(/^(\d+\.(?![A-Z]{2,3}\.)\d*|\.\d+|\d+)([ED][+-]?\d+)?/);
      if (num && num[0] !== "") {
        pos += num[0].length;
        // 1.5D0 is DOUBLE PRECISION; a REAL constant only keeps single precision
        if (num[2]?.startsWith("D")) return { v: parseFloat(num[0].replace("D", "E")), k: "D" };
        const isReal = num[0].includes(".") || !!num[2];
        return isReal ? { v: single(parseFloat(num[0])), k: "R" } : { v: parseFloat(num[0]), k: "I" };
      }
      const name = s.slice(pos).match(/^[A-Z][A-Z0-9]*/);
      if (!name) fail(`*ERROR* CAN'T READ "${text.slice(pos) || text}"`);
      pos += name![0].length;
      const id = name![0];
      if (peek("(")) {
        const end = closing(s, pos);
        if (end < 0) fail(`*ERROR* MISSING ) IN "${text}"`);
        const args = splitTop(s.slice(pos + 1, end));
        pos = end + 1;
        return call(frame, id, args);
      }
      if (frame.arrays.has(id)) fail(`*ERROR* ${id} IS AN ARRAY. SAY WHICH ELEMENT, LIKE ${id}(1)`);
      const ref = variable(frame, id);
      const k = kindOf(frame.unit, id);
      return k === "C" ? { v: ref.get(), k, im: ref.im ?? 0 } : { v: ref.get(), k };
    }

    const result = orExpr();
    if (pos !== s.length) fail(`*ERROR* CAN'T READ "${s.slice(pos)}" IN "${text}"`);
    return result;
  }

  // NAME(args): an array element, a statement function, an intrinsic or a FUNCTION
  function call(frame: Frame, name: string, args: string[]): Val {
    const arr = frame.arrays.get(name);
    if (arr) return { v: element(frame, arr, name, args).get(), k: arr.kind };
    const sf = frame.unit.stmtFns.get(name);
    if (sf) {
      const saved = sf.params.map((p) => [p, frame.vars.get(p)] as const);
      sf.params.forEach((p, i) => {
        const v = evaluate(frame, args[i] ?? "0").v;
        frame.vars.set(p, cell(kindOf(frame.unit, p) === "I" ? Math.trunc(v) : v));
      });
      try {
        const v = evaluate(frame, sf.expr);
        const k = kindOf(frame.unit, name);
        return { v: k === "I" ? Math.trunc(v.v) : v.v, k };
      } finally {
        saved.forEach(([p, ref]) => (ref ? frame.vars.set(p, ref) : frame.vars.delete(p)));
      }
    }
    if (INTRINSICS.has(name)) {
      const vals = args.map((a) => evaluate(frame, a));
      const x = vals[0]?.v ?? 0;
      // Complex numbers
      const z = vals[0];
      if (name === "CMPLX") {
        if (vals.length !== 2) fail("*ERROR* CMPLX NEEDS TWO VALUES: THE REAL AND THE IMAGINARY PART");
        return { v: single(vals[0].v), k: "C", im: single(vals[1].v) };
      }
      if (["AIMAG", "CABS", "CONJG", "CSQRT"].includes(name) && z?.k !== "C") fail(`*ERROR* ${name} NEEDS A COMPLEX VALUE`);
      if (name === "AIMAG") return { v: im(z), k: "R" };
      if (name === "CABS") return { v: single(Math.hypot(z.v, im(z))), k: "R" };
      if (name === "CONJG") return { v: z.v, k: "C", im: -im(z) };
      if (name === "CSQRT") {
        const r = Math.hypot(z.v, im(z));
        const re = Math.sqrt((r + z.v) / 2);
        const imag = Math.sqrt((r - z.v) / 2) * (im(z) < 0 ? -1 : 1);
        return { v: re, k: "C", im: imag };
      }
      if (name === "REAL" && z?.k === "C") return { v: z.v, k: "R" };
      if (z?.k === "C") fail(`*ERROR* ${name} DOESN'T WORK WITH COMPLEX VALUES. USE REAL, AIMAG OR CABS`);
      const k: Kind = INTEGER_RESULT.has(name)
        ? "I"
        : ["MAX", "MIN", "ABS", "SIGN", "MOD"].includes(name) && vals.every((v) => v.k === "I")
          ? "I"
          : DOUBLE_RESULT.has(name) || (name !== "SNGL" && name !== "REAL" && name !== "FLOAT" && vals.some((v) => v.k === "D"))
            ? "D"
            : "R";
      let v: number;
      switch (name) {
        case "SQRT": case "DSQRT": if (x < 0) fail("*ERROR* SQRT OF A NEGATIVE NUMBER. FOR COMPLEX ROOTS, USE CSQRT"); v = Math.sqrt(x); break;
        case "ABS": case "IABS": case "DABS": v = Math.abs(x); break;
        case "FLOAT": case "REAL": case "SNGL": v = single(x); break;
        case "DBLE": v = x; break;
        case "DSIN": v = Math.sin(x); break;
        case "DCOS": v = Math.cos(x); break;
        case "DEXP": v = Math.exp(x); break;
        case "DATAN": v = Math.atan(x); break;
        case "DLOG": if (x <= 0) fail("*ERROR* LOG OF A NUMBER <= 0"); v = Math.log(x); break;
        case "INT": case "IFIX": v = Math.trunc(x); break;
        case "NINT": v = Math.round(x); break;
        case "MOD": case "AMOD": if (vals[1].v === 0) fail("*ERROR* MOD BY ZERO"); v = x - Math.trunc(x / vals[1].v) * vals[1].v; break;
        case "SIN": v = Math.sin(x); break;
        case "COS": v = Math.cos(x); break;
        case "TAN": v = Math.tan(x); break;
        case "ATAN": v = Math.atan(x); break;
        case "EXP": v = Math.exp(x); break;
        case "ALOG": case "LOG": if (x <= 0) fail("*ERROR* LOG OF A NUMBER <= 0"); v = Math.log(x); break;
        case "ALOG10": case "LOG10": if (x <= 0) fail("*ERROR* LOG OF A NUMBER <= 0"); v = Math.log10(x); break;
        case "MAX": case "MAX0": case "AMAX1": v = Math.max(...vals.map((a) => a.v)); break;
        case "MIN": case "MIN0": case "AMIN1": v = Math.min(...vals.map((a) => a.v)); break;
        case "SIGN": case "ISIGN": v = Math.abs(x) * (vals[1].v < 0 ? -1 : 1); break;
        default: v = 0;
      }
      return { v: k === "I" ? Math.trunc(v) : k === "R" ? single(v) : v, k };
    }
    const fn = unitsRef.find((u) => u.kind === "FUNCTION" && u.name === name);
    if (fn) {
      const result = runUnit(fn, frame, args);
      return fn.resultKind === "C" ? { v: result.get(), k: "C", im: result.im ?? 0 } : { v: result.get(), k: fn.resultKind! };
    }
    fail(`*ERROR* ${name} IS NOT AN ARRAY OR A FUNCTION. MISSING DIMENSION ${name}(…)?`);
    return { v: 0, k: "I" };
  }

  // ----- Running statements -----

  function execute(frame: Frame, units: Unit[], commons: Map<string, Ref[]>) {
    unitsRef = units;
    commonsRef = commons;
    runStatements(frame);
  }

  // Call a SUBROUTINE or FUNCTION: arguments are passed by reference, like on the real machines
  function runUnit(unit: Unit, caller: Frame, args: string[]): Ref {
    if (args.length !== unit.params.length) fail(`*ERROR* ${unit.name} NEEDS ${unit.params.length} ARGUMENT${unit.params.length === 1 ? "" : "S"}`);
    const bound = new Map<string, Ref | ArrayObj>();
    unit.params.forEach((p, i) => {
      const a = args[i];
      const plain = a.match(/^([A-Z][A-Z0-9]*)$/);
      if (plain && caller.arrays.has(plain[1])) return bound.set(p, caller.arrays.get(plain[1])!);
      if (plain || /^[A-Z][A-Z0-9]*\(.*\)$/.test(a)) {
        if (plain || caller.arrays.has(a.slice(0, a.indexOf("(")))) return bound.set(p, target(caller, a).ref);
      }
      // an expression: passed as a copy
      const val = evaluate(caller, a);
      const c = cell(val.v);
      if (val.k === "C") c.im = val.im ?? 0;
      bound.set(p, c);
    });
    const frame = makeFrame(unit, commonsRef, bound);
    if (unit.kind === "FUNCTION") frame.vars.set(unit.name, cell());
    runStatements(frame);
    return unit.kind === "FUNCTION" ? frame.vars.get(unit.name)! : cell();
  }

  function runStatements(frame: Frame) {
    const unit = frame.unit;
    const sts = unit.statements;
    type Loop = { label: number; endIndex: number; bodyIndex: number; ref: { ref: Ref; kind: Kind }; end: number; step: number };
    const loops: Loop[] = [];
    let pc = 0;

    const indexOfLabel = (label: number, st: Statement) => {
      const i = unit.labels.get(label);
      if (i === undefined) fail(`*ERROR* THERE IS NO STATEMENT ${label} (CARD ${st.card})`);
      return i!;
    };
    const jump = (index: number) => {
      // Jumping out of a DO loop ends it
      while (loops.length && (index < loops[loops.length - 1].bodyIndex || index > loops[loops.length - 1].endIndex)) loops.pop();
      pc = index;
    };

    while (pc < sts.length) {
      if (++steps > MAX_STEPS) fail("*ERROR* TIME LIMIT EXCEEDED. THE JOB NEVER STOPPED: CHECK YOUR LOOPS");
      const st = sts[pc];
      const here = pc;
      pc++;
      const outcome = runOne(frame, st, here);
      if (outcome === "STOP") throw new StopSignal();
      if (outcome === "RETURN") return;
      if (typeof outcome === "number") {
        jump(outcome);
        continue;
      }
      if (outcome && typeof outcome === "object") {
        // A new DO loop
        loops.push({ ...outcome, bodyIndex: pc });
        const first = outcome.ref.ref.get();
        if (outcome.step > 0 ? first > outcome.end : first < outcome.end) {
          loops.pop();
          pc = outcome.endIndex + 1; // the range is empty: skip the loop
        }
        continue;
      }
      // End of a DO range: count and repeat (inner loops first, several loops may share one label)
      while (st.label !== null && loops.length && loops[loops.length - 1].endIndex === here) {
        const loop = loops[loops.length - 1];
        const next = loop.ref.ref.get() + loop.step;
        loop.ref.ref.set(next);
        if (loop.step > 0 ? next <= loop.end : next >= loop.end) {
          pc = loop.bodyIndex;
          break;
        }
        loops.pop();
      }
    }

    function runOne(frame: Frame, st: Statement, index: number): number | "STOP" | "RETURN" | Omit<Loop, "bodyIndex"> | null {
      const t = st.text;
      let m;
      if (/^(FORMAT\(|DIMENSION|COMMON|DATA.*\/$)/.test(t) || isDecl(t)) return null;
      if (t === "CONTINUE") return null;
      if (t === "STOP" || /^STOP\d*$/.test(t)) return "STOP";
      if (t === "PAUSE" || /^PAUSE/.test(t)) return null;
      if (t === "END") return unit.kind === "MAIN" ? "STOP" : "RETURN";
      if (t === "RETURN") {
        if (unit.kind === "MAIN") fail(`*ERROR* RETURN IN THE MAIN PROGRAM (CARD ${st.card})`);
        return "RETURN";
      }

      // GO TO 10 / GO TO (10, 20, 30), I
      if ((m = t.match(/^GOTO(\d+)$/))) return indexOfLabel(parseInt(m[1], 10), st);
      if ((m = t.match(/^GOTO\(([\d,]+)\),?(.+)$/))) {
        const targets = m[1].split(",").map(Number);
        const k = Math.trunc(evaluate(frame, m[2]).v);
        return k >= 1 && k <= targets.length ? indexOfLabel(targets[k - 1], st) : null;
      }

      // DO 10 I = 1, 10, 2
      if ((m = t.match(/^DO(\d+)([A-Z][A-Z0-9]*)=(.+)$/)) && splitTop(m[3]).length >= 2) {
        const parts = splitTop(m[3]);
        const label = parseInt(m[1], 10);
        const endIndex = indexOfLabel(label, st);
        if (endIndex <= index) fail(`*ERROR* DO ${label} MUST END AT A LATER STATEMENT (CARD ${st.card})`);
        const ref = target(frame, m[2]);
        store(ref, evaluate(frame, parts[0]).v);
        const step = parts[2] ? evaluate(frame, parts[2]).v : 1;
        if (step === 0) fail(`*ERROR* DO STEP CAN'T BE 0 (CARD ${st.card})`);
        return { label, endIndex, ref, end: evaluate(frame, parts[1]).v, step };
      }

      // IF (X) 10, 20, 30   and   IF (A .GT. B) statement
      if (/^IF\(/.test(t)) {
        const end = closing(t, 2);
        if (end < 0) fail(`*ERROR* MISSING ) IN IF (CARD ${st.card})`);
        const cond = t.slice(3, end);
        const rest = t.slice(end + 1);
        if ((m = rest.match(/^(\d+),(\d+),(\d+)$/))) {
          const v = evaluate(frame, cond).v;
          return indexOfLabel(parseInt(v < 0 ? m[1] : v === 0 ? m[2] : m[3], 10), st);
        }
        const c = evaluate(frame, cond);
        if (c.k !== "L") fail(`*ERROR* IF NEEDS A CONDITION LIKE (X .GT. 0), OR THREE LABELS (CARD ${st.card})`);
        if (!c.v) return null;
        if (/^(IF|DO\d)/.test(rest)) fail(`*ERROR* NO IF OR DO AFTER A LOGICAL IF (CARD ${st.card})`);
        return runOne(frame, { ...st, text: rest, raw: st.raw.slice(st.raw.indexOf(")") + 1) }, index);
      }

      // CALL NAME(args)
      if ((m = t.match(/^CALL([A-Z][A-Z0-9]*)(?:\((.*)\))?$/))) {
        const sub = unitsRef.find((u) => u.kind === "SUBROUTINE" && u.name === m![1]);
        if (!sub) fail(`*ERROR* THERE IS NO SUBROUTINE ${m[1]} (CARD ${st.card})`);
        runUnit(sub!, frame, m[2] ? splitTop(m[2]) : []);
        return null;
      }

      // WRITE (6, 10) list   /   PRINT 10, list
      if ((m = t.match(/^WRITE\((\d+),(\d+|\*)\)(.*)$/)) || (m = t.match(/^PRINT(\d+|\*)(?:,(.*))?$/))) {
        const isWrite = t.startsWith("WRITE");
        if (isWrite && m[1] !== "6") fail(`*ERROR* UNIT ${m[1]}: WRITE TO UNIT 6, THE LINE PRINTER (CARD ${st.card})`);
        const fmt = isWrite ? m[2] : m[1];
        const list = (isWrite ? m[3] : m[2] ?? "").trim();
        write(frame, fmt, list ? expandList(frame, list) : [], st);
        return null;
      }

      // READ (5, 10) list   /   READ 10, list
      if ((m = t.match(/^READ\((\d+),(\d+|\*)\)(.*)$/)) || (m = t.match(/^READ(\d+|\*),(.*)$/))) {
        const isUnit = t.startsWith("READ(");
        if (isUnit && m[1] !== "5") fail(`*ERROR* UNIT ${m[1]}: READ FROM UNIT 5, THE CARD READER (CARD ${st.card})`);
        // implied DO loops work like in WRITE: READ (5,10) (A(I), I = 1, 5)
        read(frame, isUnit ? m[2] : m[1], expandList(frame, isUnit ? m[3] : m[2]), st);
        return null;
      }

      // Statement function definition: nothing to do at run time
      if ((m = t.match(/^([A-Z][A-Z0-9]*)\(/)) && unit.stmtFns.has(m[1]) && t.includes("=")) return null;

      // Assignment
      const eq = splitTop(t, "=");
      if (eq.length === 2 && /^[A-Z]/.test(eq[0])) {
        store(target(frame, eq[0]), evaluate(frame, eq[1]));
        return null;
      }
      fail(`*ERROR* UNKNOWN STATEMENT "${st.raw.trim()}" (CARD ${st.card})`);
      return null;
    }
  }

  // ----- Input and output -----

  // A WRITE list, with implied DO loops like (A(I), I = 1, 5)
  function expandList(frame: Frame, list: string): string[] {
    const out: string[] = [];
    for (const item of splitTop(list)) {
      const m = item.match(/^\((.*),([A-Z][A-Z0-9]*)=([^,]+),([^,]+)(?:,([^,]+))?\)$/);
      if (m) {
        const ref = target(frame, m[2]);
        const from = evaluate(frame, m[3]).v;
        const to = evaluate(frame, m[4]).v;
        const step = m[5] ? evaluate(frame, m[5]).v : 1;
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          store(ref, i);
          // freeze the index into the item, so it's evaluated with the right value
          for (const inner of expandList(frame, m[1])) out.push(`${inner.replace(new RegExp(`\\b${m[2]}\\b`, "g"), `(${i})`)}`);
        }
      } else if (/^[A-Z][A-Z0-9]*$/.test(item) && frame.arrays.has(item)) {
        // A whole array, in storage order: column by column, like the IBM machines kept it in memory
        const arr = frame.arrays.get(item)!;
        arr.data.forEach((_, i) => {
          const idx: number[] = [];
          let rest = i;
          for (const d of arr.dims) {
            idx.push((rest % d) + 1);
            rest = Math.floor(rest / d);
          }
          out.push(`${item}(${idx.join(",")})`);
        });
      } else out.push(item);
    }
    return out;
  }

  function write(frame: Frame, fmtLabel: string, items: string[], st: Statement) {
    const given = items.map((e) => {
      if (/^'.*'$/.test(e)) fail(`*ERROR* PUT TEXT INTO THE FORMAT, NOT INTO THE WRITE LIST (CARD ${st.card})`);
      return evaluate(frame, e);
    });
    if (fmtLabel === "*") {
      // List-directed output (FORTRAN 77 style): values separated by blanks
      const show = (v: Val) =>
        v.k === "I" ? String(v.v) : v.k === "L" ? (v.v ? "T" : "F") : v.k === "C" ? `(${formatReal(v.v)},${formatReal(v.im ?? 0)})` : v.k === "D" ? formatReal(v.v, 15) : formatReal(v.v);
      lines.push(given.map(show).join("  ").trimStart());
      return;
    }
    // A complex value fills two fields: the real part, then the imaginary part
    const values: Val[] = given.flatMap((v) => (v.k === "C" ? [{ v: v.v, k: "R" as Kind }, { v: v.im ?? 0, k: "R" as Kind }] : [v]));
    const fmt = frame.unit.formats.get(parseInt(fmtLabel, 10));
    if (!fmt) fail(`*ERROR* THERE IS NO FORMAT ${fmtLabel} (CARD ${st.card})`);
    let vi = 0;
    record = "";
    const flush = () => {
      lines.push(...printLine(record).split("\n"));
      record = "";
    };
    // Walk the format. Returns false when the list ran out at a data item.
    const walk = (list: FItem[]): boolean => {
      for (const item of list) {
        switch (item.t) {
          case "TEXT": record += item.s; break;
          case "X": record += " ".repeat(item.n); break;
          case "SLASH": flush(); break;
          case "GROUP":
            for (let r = 0; r < item.n; r++) if (!walk(item.items)) return false;
            break;
          default: {
            if (vi >= values.length) return false;
            const v = values[vi++];
            const what = items[Math.min(vi - 1, items.length - 1)];
            if (item.t === "A") record += formatA(v.v, item.w);
            else if (item.t === "L") {
              if (v.k !== "L") fail(`*ERROR* L FORMAT IS FOR LOGICAL VALUES (${what}) (CARD ${st.card})`);
              record += (v.v ? "T" : "F").padStart(item.w);
            } else if (item.t === "I") {
              if (v.k === "L") fail(`*ERROR* I FORMAT FOR A LOGICAL VALUE (${what}). USE L, LIKE L2 (CARD ${st.card})`);
              if (v.k === "R" || v.k === "D") fail(`*ERROR* I FORMAT FOR A REAL VALUE (${what}). USE F, LIKE F8.2 (CARD ${st.card})`);
              record += formatI(v.v, item.w);
            } else {
              if (v.k === "I") fail(`*ERROR* ${item.t} FORMAT FOR AN INTEGER (${what}). USE I, LIKE I5 (CARD ${st.card})`);
              if (v.k === "L") fail(`*ERROR* ${item.t} FORMAT FOR A LOGICAL VALUE (${what}). USE L, LIKE L2 (CARD ${st.card})`);
              record += item.t === "F" ? formatF(v.v, item.w, item.d) : item.t === "E" ? formatE(v.v, item.w, item.d) : formatE(v.v, item.w, item.d).replace("E", "D");
            }
          }
        }
      }
      return true;
    };
    // When the values outlast the format, FORTRAN starts a new line and goes back to the last group in brackets
    // (or to the start, if there is no group)
    const lastGroup = fmt!.map((it) => it.t).lastIndexOf("GROUP");
    const again = lastGroup >= 0 ? fmt!.slice(lastGroup) : fmt!;
    let rounds = 0;
    while (true) {
      const finished = walk(rounds === 0 ? fmt! : again);
      if (!finished || vi >= values.length) break;
      // More values than the format has room for: start a new line and use the format again
      if (++rounds > 1000 || !fmt!.some(hasDataItem)) fail(`*ERROR* FORMAT ${fmtLabel} HAS NO ROOM FOR THE VALUES (CARD ${st.card})`);
      flush();
    }
    flush();
  }

  function read(frame: Frame, fmtLabel: string, items: string[], st: Statement) {
    const targets = items.map((e) => target(frame, e));
    if (fmtLabel === "*") {
      // List-directed: values separated by commas or blanks, as many cards as needed
      let pending: string[] = [];
      for (const t of targets) {
        while (pending.length === 0) {
          if (cards.length === 0) fail(`*ERROR* END OF DATA: NO MORE CARDS TO READ (CARD ${st.card})`);
          pending = cards.shift()!.split(/[\s,]+/).filter((x) => x !== "");
        }
        const v = Number(pending.shift());
        if (Number.isNaN(v)) fail(`*ERROR* NOT A NUMBER ON THE DATA CARD (CARD ${st.card})`);
        store(t, v);
      }
      return;
    }
    const fmt = frame.unit.formats.get(parseInt(fmtLabel, 10));
    if (!fmt) fail(`*ERROR* THERE IS NO FORMAT ${fmtLabel} (CARD ${st.card})`);
    if (cards.length === 0) fail(`*ERROR* END OF DATA: NO MORE CARDS TO READ (CARD ${st.card})`);
    let card = cards.shift()!;
    const nextCard = () => {
      if (cards.length === 0) fail(`*ERROR* END OF DATA: NO MORE CARDS TO READ (CARD ${st.card})`);
      card = cards.shift()!;
      col = 0;
    };
    let col = 0;
    let ti = 0;
    const walk = (list: FItem[]): boolean => {
      for (const item of list) {
        if (item.t === "X") col += item.n;
        else if (item.t === "TEXT") col += item.s.length;
        else if (item.t === "SLASH") nextCard();
        else if (item.t === "GROUP") {
          for (let r = 0; r < item.n; r++) if (!walk(item.items)) return false;
        } else {
          if (ti >= targets.length) return false;
          const raw = card.slice(col, col + item.w).padEnd(item.w, " ");
          if (item.t === "A") {
            // Text: up to 4 characters per variable; a wider field keeps its last 4
            col += item.w;
            const text = item.w >= CHARS_PER_WORD ? raw.slice(item.w - CHARS_PER_WORD) : raw;
            targets[ti++].ref.set(encodeText(text));
            continue;
          }
          if (item.t === "L") {
            col += item.w;
            const c = raw.trim().replace(/^\./, "")[0] ?? "F";
            store(targets[ti++], c.toUpperCase() === "T" ? 1 : 0);
            continue;
          }
          // Like the real card readers: blanks inside a field count as zeros, so "4 2" in I3 is 402
          const field = raw.trim() === "" ? "" : raw.replace(/^ +/, "").replace(/ /g, "0");
          col += item.w;
          let v = field === "" ? 0 : Number(field);
          if (Number.isNaN(v)) fail(`*ERROR* "${field}" IS NOT A NUMBER (DATA CARD, COLUMNS ${col - item.w + 1}-${col})`);
          // F fields without a decimal point get an implied one, like on the real cards
          if (item.t !== "I" && field !== "" && !field.includes(".") && !/E/i.test(field)) v = v / Math.pow(10, item.d);
          store(targets[ti++], v);
        }
      }
      return true;
    };
    walk(fmt!);
    // More values than the format reads: take the next card and use the format again
    while (ti < targets.length) {
      if (!fmt!.some(hasDataItem)) fail(`*ERROR* FORMAT ${fmtLabel} READS FEWER VALUES THAN THE LIST NEEDS (CARD ${st.card})`);
      nextCard();
      walk(fmt!);
    }
  }
}

class StopSignal extends Error {}

function hasDataItem(item: FItem): boolean {
  return ["I", "F", "E", "D", "L", "A"].includes(item.t) || (item.t === "GROUP" && item.items.some(hasDataItem));
}

function formatReal(v: number, digits = 7) {
  const text = Number(v.toPrecision(digits)).toString();
  return text.includes(".") || text.includes("e") ? text : text + ".0";
}
