// A small Pascal interpreter in the style of Turbo Pascal on an IBM PC (1983 and later).
// It runs the lesson programs and shows errors the way the Turbo Pascal compiler did:
//   Error 85: ";" expected. (line 4)        ← found while compiling: nothing runs
//   Runtime error 200: Division by zero (line 7)
// Supported: program/uses headers, const, type, var, procedures and functions (value, var and
// const parameters, nesting, recursion, forward), integer types (16-bit integer that overflows like
// the real thing, longint, byte, word, shortint), real, boolean, char, string and string[n],
// enumerations, subranges, arrays (also several dimensions), records, sets, pointers (new, dispose),
// text files and typed files (file of …) on a small simulated disk, units (unit … interface …
// implementation … end.), the crt screen (clrscr, gotoxy), if, case, for, while, repeat, with, exit, break, continue.
import type { RunResult } from "./course";

const MAX_STEPS = 2_000_000;
const MAX_OUTPUT = 20_000;
const MAX_DEPTH = 900;

// ---------- Types ----------

type IntName = "integer" | "longint" | "byte" | "word" | "shortint";
type T =
  | { k: "int"; name: IntName; lo: number; hi: number }
  | { k: "real" }
  | { k: "bool" }
  | { k: "char" }
  | { k: "str"; max: number }
  | { k: "enum"; name: string; names: string[] }
  | { k: "sub"; base: T; lo: number; hi: number }
  | { k: "array"; index: T; lo: number; hi: number; of: T }
  | { k: "record"; name: string; fields: { name: string; t: T }[] }
  | { k: "set"; of: T }
  | { k: "ptr"; to: T | null; toName?: string; env?: Env; name?: string }
  | { k: "text" }
  | { k: "file"; of: T }
  | { k: "nil" }
  | { k: "void" };

const INTS: Record<IntName, T & { k: "int" }> = {
  integer: { k: "int", name: "integer", lo: -32768, hi: 32767 },
  longint: { k: "int", name: "longint", lo: -2147483648, hi: 2147483647 },
  byte: { k: "int", name: "byte", lo: 0, hi: 255 },
  word: { k: "int", name: "word", lo: 0, hi: 65535 },
  shortint: { k: "int", name: "shortint", lo: -128, hi: 127 },
};
const INTEGER = INTS.integer;
const LONGINT = INTS.longint;
const REAL: T = { k: "real" };
const BOOL: T = { k: "bool" };
const CHAR: T = { k: "char" };
const STRING: T = { k: "str", max: 255 };
const NIL: T = { k: "nil" };
const VOID: T = { k: "void" };

function typeName(t: T): string {
  switch (t.k) {
    case "int":
      return t.name.toUpperCase();
    case "real":
      return "REAL";
    case "bool":
      return "BOOLEAN";
    case "char":
      return "CHAR";
    case "str":
      return t.max === 255 ? "STRING" : `STRING[${t.max}]`;
    case "enum":
      return t.name.toUpperCase();
    case "sub":
      return `${t.lo}..${t.hi}`;
    case "array":
      return `ARRAY OF ${typeName(t.of)}`;
    case "record":
      return t.name.toUpperCase();
    case "set":
      return `SET OF ${typeName(t.of)}`;
    case "ptr":
      return t.name ? t.name.toUpperCase() : "POINTER";
    case "text":
      return "TEXT";
    case "file":
      return `FILE OF ${typeName(t.of)}`;
    case "nil":
      return "NIL";
    case "void":
      return "nothing";
  }
}

// Ordinal types: the ones that can be counted (integer, char, boolean, enumerations, subranges)
const base = (t: T): T => (t.k === "sub" ? t.base : t);
const isOrdinal = (t: T) => ["int", "char", "bool", "enum", "sub"].includes(t.k);
const isNumeric = (t: T) => base(t).k === "int" || t.k === "real";
const isInt = (t: T) => base(t).k === "int";
const isStringy = (t: T) => t.k === "str" || t.k === "char";

function ordLow(t: T): number {
  const b = t;
  if (b.k === "sub") return b.lo;
  if (b.k === "int") return b.lo;
  if (b.k === "char" || b.k === "bool" || b.k === "enum") return 0;
  return 0;
}
function ordHigh(t: T): number {
  if (t.k === "sub") return t.hi;
  if (t.k === "int") return t.hi;
  if (t.k === "char") return 255;
  if (t.k === "bool") return 1;
  if (t.k === "enum") return t.names.length - 1;
  return 0;
}

// ---------- Errors ----------

class CompileError extends Error {}
class RuntimeError extends Error {}
class HaltSignal {}
class ExitSignal {}
class BreakSignal {}
class ContinueSignal {}

const TP_ERRORS: Record<number, string> = {
  2: "Identifier expected.",
  3: "Unknown identifier.",
  4: "Duplicate identifier.",
  5: "Syntax error.",
  10: "Unexpected end of file.",
  15: "File not found.",
  20: "Variable identifier expected.",
  22: "Structure too large.",
  26: "Type mismatch.",
  31: "Constant expected.",
  36: "BEGIN expected.",
  37: "END expected.",
  40: "Integer or real expression expected.",
  41: "Operand types do not match operator.",
  42: "Error in expression.",
  43: "Illegal assignment.",
  57: "THEN expected.",
  58: "TO or DOWNTO expected.",
  62: "Division by zero.",
  64: "Cannot read or write variables of this type.",
  66: "Cannot read or write variables of this type.",
  74: "Constant and case types do not match.",
  76: "Constant out of range.",
  85: '";" expected.',
  86: '":" expected.',
  87: '"," expected.',
  88: '"(" expected.',
  89: '")" expected.',
  90: '"=" expected.',
  91: '":=" expected.',
  92: '"[" or "(." expected.',
  93: '"]" or ".)" expected.',
  94: '"." expected.',
  97: "Invalid FOR control variable.",
  113: "Error in statement.",
  122: "Invalid variable reference.",
  123: "Pointer variable expected.",
  126: "Too many variables.",
  131: "Header does not match previous definition.",
  133: "Cannot evaluate this expression.",
};

function compileError(code: number, line: number, hint?: string): never {
  throw new CompileError(`Error ${code}: ${TP_ERRORS[code] ?? "Syntax error."}${hint ? " " + hint : ""} (line ${line})`);
}
function runtimeError(code: number, text: string, line: number): never {
  throw new RuntimeError(`Runtime error ${code}: ${text} (line ${line})`);
}

// ---------- Tokens ----------

type Tok = { t: "id" | "num" | "str" | "op" | "eof"; v: string; n?: number; real?: boolean; line: number; orig?: string };

const KEYWORDS = new Set([
  "and", "array", "begin", "case", "const", "div", "do", "downto", "else", "end", "file", "for", "forward", "function",
  "goto", "if", "in", "label", "mod", "nil", "not", "of", "or", "otherwise", "packed", "procedure", "program", "record",
  "repeat", "set", "shl", "shr", "string", "then", "to", "type", "until", "uses", "var", "while", "with", "xor",
  "unit", "interface", "implementation",
]);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // Comments: { … }, (* … *) and // …
    if (c === "{" || (c === "(" && src[i + 1] === "*")) {
      const close = c === "{" ? "}" : "*)";
      const startLine = line;
      const end = src.indexOf(close, i + (c === "{" ? 1 : 2));
      if (end < 0) compileError(10, startLine, "A comment is never closed.");
      for (let k = i; k < end; k++) if (src[k] === "\n") line++;
      i = end + close.length;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      toks.push({ t: "id", v: word.toLowerCase(), orig: word, line });
      i = j;
      continue;
    }
    if (/\d/.test(c)) {
      let j = i;
      while (/\d/.test(src[j] ?? "")) j++;
      let real = false;
      // 1.5 is a real number, but 1..5 is a range
      if (src[j] === "." && /\d/.test(src[j + 1] ?? "")) {
        real = true;
        j++;
        while (/\d/.test(src[j] ?? "")) j++;
      }
      if (/[eE]/.test(src[j] ?? "") && /[\d+-]/.test(src[j + 1] ?? "")) {
        real = true;
        j += 2;
        while (/\d/.test(src[j] ?? "")) j++;
      }
      const text = src.slice(i, j);
      toks.push({ t: "num", v: text, n: Number(text), real, line });
      i = j;
      continue;
    }
    if (c === "$" && /[0-9A-Fa-f]/.test(src[i + 1] ?? "")) {
      let j = i + 1;
      while (/[0-9A-Fa-f]/.test(src[j] ?? "")) j++;
      toks.push({ t: "num", v: src.slice(i, j), n: parseInt(src.slice(i + 1, j), 16), line });
      i = j;
      continue;
    }
    // Strings: 'it''s' and character codes like #13#10, which can be glued together
    if (c === "'" || (c === "#" && /\d/.test(src[i + 1] ?? ""))) {
      let s = "";
      while (src[i] === "'" || (src[i] === "#" && /\d/.test(src[i + 1] ?? ""))) {
        if (src[i] === "'") {
          i++;
          while (true) {
            if (i >= src.length || src[i] === "\n") compileError(8, line, "String constant exceeds line: a ' is missing.");
            if (src[i] === "'") {
              if (src[i + 1] === "'") {
                s += "'";
                i += 2;
                continue;
              }
              i++;
              break;
            }
            s += src[i++];
          }
        } else {
          let j = i + 1;
          while (/\d/.test(src[j] ?? "")) j++;
          s += String.fromCharCode(Number(src.slice(i + 1, j)) & 255);
          i = j;
        }
      }
      toks.push({ t: "str", v: s, line });
      continue;
    }
    const two = src.slice(i, i + 2);
    if ([":=", "<=", ">=", "<>", ".."].includes(two)) {
      toks.push({ t: "op", v: two, line });
      i += 2;
      continue;
    }
    if ("+-*/=<>()[].,:;^@".includes(c)) {
      toks.push({ t: "op", v: c, line });
      i++;
      continue;
    }
    compileError(5, line, `The character ${c} doesn't belong in Pascal.`);
  }
  toks.push({ t: "eof", v: "", line });
  return toks;
}

// ---------- Syntax tree ----------

type TypeExpr =
  | { k: "named"; name: string; line: number }
  | { k: "string"; max: Expr | null }
  | { k: "enum"; names: string[] }
  | { k: "sub"; lo: Expr; hi: Expr }
  | { k: "array"; index: TypeExpr[]; of: TypeExpr }
  | { k: "record"; fields: { names: string[]; t: TypeExpr }[] }
  | { k: "set"; of: TypeExpr }
  | { k: "ptr"; to: string }
  | { k: "text" }
  | { k: "file"; of: TypeExpr };

type Expr =
  | { k: "num"; v: number; real: boolean; line: number }
  | { k: "str"; v: string; line: number }
  | { k: "nil"; line: number }
  | { k: "id"; name: string; line: number }
  | { k: "call"; name: string; args: Expr[]; line: number }
  | { k: "idx"; base: Expr; index: Expr[]; line: number }
  | { k: "field"; base: Expr; name: string; line: number }
  | { k: "deref"; base: Expr; line: number }
  | { k: "un"; op: string; e: Expr; line: number }
  | { k: "bin"; op: string; l: Expr; r: Expr; line: number }
  | { k: "set"; items: { lo: Expr; hi: Expr | null }[]; line: number }
  | { k: "fmt"; e: Expr; width: Expr; decimals: Expr | null; line: number } // only inside write/writeln
  | { k: "list"; items: Expr[]; line: number }; // (1, 2, 3): the value of a typed array constant

type Stmt =
  | { k: "assign"; target: Expr; e: Expr; line: number }
  | { k: "call"; name: string; args: Expr[]; line: number }
  | { k: "block"; body: Stmt[]; line: number }
  | { k: "if"; cond: Expr; then: Stmt; else: Stmt | null; line: number }
  | { k: "case"; e: Expr; arms: { labels: { lo: Expr; hi: Expr | null }[]; body: Stmt }[]; other: Stmt[] | null; line: number }
  | { k: "for"; v: string; from: Expr; to: Expr; down: boolean; body: Stmt; line: number }
  | { k: "while"; cond: Expr; body: Stmt; line: number }
  | { k: "repeat"; body: Stmt[]; cond: Expr; line: number }
  | { k: "with"; recs: Expr[]; body: Stmt; line: number }
  | { k: "empty"; line: number };

type Param = { name: string; mode: "value" | "var" | "const"; t: TypeExpr | null; line: number };
type Routine = {
  name: string;
  kind: "procedure" | "function";
  params: Param[];
  ret: TypeExpr | null;
  block: Block | null; // null while only declared as forward
  line: number;
};
type Decl =
  | { k: "const"; name: string; e: Expr; t: TypeExpr | null; line: number }
  | { k: "type"; name: string; t: TypeExpr; line: number }
  | { k: "var"; names: string[]; t: TypeExpr; init: Expr | null; line: number }
  | { k: "routine"; r: Routine };
type Block = { decls: Decl[]; body: Stmt[]; line: number; units?: UnitDef[]; uses?: { name: string; line: number }[] };
// A Turbo Pascal unit: what's in the interface can be used by the program, the rest is private
type UnitDef = { name: string; iface: Decl[]; impl: Decl[]; init: Stmt[]; uses: { name: string; line: number }[]; line: number };
const SYSTEM_UNITS = new Set(["crt", "dos", "printer", "graph", "system"]);
const CRT_ROUTINES = new Set(["clrscr", "gotoxy", "clreol", "wherex", "wherey", "readkey", "keypressed", "delay", "sound", "nosound", "textcolor", "textbackground", "highvideo", "lowvideo", "normvideo"]);

// ---------- Parser ----------

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}

  peek(o = 0) {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  next() {
    return this.toks[this.i++] ?? this.toks[this.toks.length - 1];
  }
  is(v: string, o = 0) {
    const t = this.peek(o);
    return (t.t === "op" || t.t === "id") && t.v === v;
  }
  eat(v: string) {
    if (this.is(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  // Like the Turbo Pascal compiler, a missing ; is reported at the end of the line before
  expect(v: string, code: number) {
    if (this.eat(v)) return;
    const t = this.peek();
    if (t.t === "eof") compileError(10, this.toks[Math.max(0, this.i - 1)].line);
    const line = v === ";" && this.i > 0 ? this.toks[this.i - 1].line : t.line;
    compileError(code, line);
  }
  ident(): string {
    const t = this.peek();
    if (t.t !== "id" || KEYWORDS.has(t.v)) {
      if (t.t === "eof") compileError(10, t.line);
      compileError(2, t.line);
    }
    this.i++;
    return t.v;
  }

  program(): Block {
    const units: UnitDef[] = [];
    while (this.is("unit")) units.push(this.unit());
    const line = this.peek().line;
    if (this.eat("program")) {
      this.ident();
      if (this.eat("(")) {
        // program Hello(input, output);
        while (!this.eat(")")) this.next();
      }
      this.expect(";", 85);
    }
    const uses = this.usesClause();
    const block = this.block(line);
    if (!this.is(".")) {
      const t = this.peek();
      if (t.t === "eof") compileError(94, this.toks[Math.max(0, this.i - 1)].line, "The program ends with END and a full stop: end.");
      compileError(94, t.line);
    }
    block.units = units;
    block.uses = uses;
    return block;
  }

  usesClause(): { name: string; line: number }[] {
    const uses: { name: string; line: number }[] = [];
    if (this.eat("uses")) {
      do uses.push({ line: this.peek().line, name: this.ident() });
      while (this.eat(","));
      this.expect(";", 85);
    }
    return uses;
  }

  // unit Name; interface … implementation … [begin …] end.
  unit(): UnitDef {
    const line = this.next().line;
    const name = this.ident();
    this.expect(";", 85);
    if (!this.eat("interface")) compileError(5, this.peek().line, "A unit starts with its INTERFACE part: what other programs may use.");
    const uses = this.usesClause();
    const iface = this.decls(true);
    if (!this.eat("implementation")) compileError(5, this.peek().line, "After the interface comes IMPLEMENTATION, with the routines' bodies.");
    const impl = this.decls(false);
    let init: Stmt[] = [];
    if (this.is("begin")) init = this.compound().body;
    else if (!this.eat("end")) compileError(5, this.peek().line, "A unit ends with END and a full stop: end.");
    this.expect(".", 94);
    return { name, iface, impl, init, uses, line };
  }

  block(line: number): Block {
    const decls = this.decls(false);
    if (!this.is("begin")) {
      const t = this.peek();
      if (t.t === "eof") compileError(10, t.line);
      compileError(36, t.line);
    }
    const body = this.compound();
    return { decls, body: body.body, line };
  }

  // const, type, var and routines. In a unit's interface, routines are only headings.
  decls(headingsOnly: boolean): Decl[] {
    const decls: Decl[] = [];
    while (true) {
      if (this.eat("const")) {
        while (this.peek().t === "id" && !KEYWORDS.has(this.peek().v)) {
          const l = this.peek().line;
          const name = this.ident();
          let t: TypeExpr | null = null;
          if (this.eat(":")) t = this.typeExpr(); // typed constant: works like an initialized variable
          if (!this.is("=")) compileError(90, this.peek().line, ":= is for assignments. Constants use = .");
          this.next();
          const e = t ? this.initValue() : this.expr();
          this.expect(";", 85);
          decls.push(t ? { k: "var", names: [name], t, init: e, line: l } : { k: "const", name, e, t: null, line: l });
        }
      } else if (this.eat("type")) {
        while (this.peek().t === "id" && !KEYWORDS.has(this.peek().v)) {
          const l = this.peek().line;
          const name = this.ident();
          this.expect("=", 90);
          const t = this.typeExpr();
          this.expect(";", 85);
          decls.push({ k: "type", name, t, line: l });
        }
      } else if (this.eat("var")) {
        while (this.peek().t === "id" && !KEYWORDS.has(this.peek().v)) {
          const l = this.peek().line;
          const names = [this.ident()];
          while (this.eat(",")) names.push(this.ident());
          if (!this.is(":")) compileError(86, this.peek().line, "Write the type after a colon, like x: integer;");
          this.next();
          const t = this.typeExpr();
          let init: Expr | null = null;
          if (this.eat("=")) init = this.initValue(); // var x: integer = 5; (newer Pascals)
          this.expect(";", 85);
          decls.push({ k: "var", names, t, init, line: l });
        }
      } else if (this.is("procedure") || this.is("function")) {
        decls.push({ k: "routine", r: this.routine(headingsOnly) });
      } else if (this.is("label")) {
        compileError(5, this.peek().line, "GOTO and labels aren't used in these lessons.");
      } else break;
    }
    return decls;
  }

  routine(headingOnly = false): Routine {
    const kind = this.next().v as "procedure" | "function";
    const line = this.peek().line;
    const name = this.ident();
    const params: Param[] = [];
    if (this.eat("(")) {
      if (!this.eat(")")) {
        do {
          const l = this.peek().line;
          let mode: Param["mode"] = "value";
          if (this.eat("var")) mode = "var";
          else if (this.eat("const")) mode = "const";
          const names = [this.ident()];
          while (this.eat(",")) names.push(this.ident());
          let t: TypeExpr | null = null;
          if (this.eat(":")) t = this.typeExpr(true);
          else if (mode === "value") compileError(86, this.peek().line);
          for (const n of names) params.push({ name: n, mode, t, line: l });
        } while (this.eat(";"));
        this.expect(")", 89);
      }
    }
    let ret: TypeExpr | null = null;
    // In a unit's implementation, Turbo Pascal lets you leave out what the interface already said
    if (kind === "function" && !(this.is(";") && params.length === 0 && !headingOnly)) {
      if (!this.is(":")) compileError(86, this.peek().line, "A function needs a result type, like : integer");
      this.next();
      ret = this.typeExpr(true);
    }
    this.expect(";", 85);
    if (headingOnly) return { name, kind, params, ret, block: null, line };
    if (this.eat("forward")) {
      this.expect(";", 85);
      return { name, kind, params, ret, block: null, line };
    }
    const block = this.block(line);
    this.expect(";", 85);
    return { name, kind, params, ret, block, line };
  }

  // In parameter lists only type names (and string) are allowed, like in real Pascal
  typeExpr(paramOnly = false): TypeExpr {
    const t = this.peek();
    if (this.eat("string")) {
      if (!paramOnly && this.eat("[")) {
        const max = this.expr();
        this.expect("]", 93);
        return { k: "string", max };
      }
      return { k: "string", max: null };
    }
    if (paramOnly) {
      if (this.is("array")) {
        // open array: procedure show(a: array of integer)
        this.next();
        this.expect("of", 5);
        return { k: "array", index: [], of: this.typeExpr(true) };
      }
      return { k: "named", name: this.ident(), line: t.line };
    }
    this.eat("packed");
    if (this.eat("^")) return { k: "ptr", to: this.ident() };
    if (this.eat("(")) {
      const names = [this.ident()];
      while (this.eat(",")) names.push(this.ident());
      this.expect(")", 89);
      return { k: "enum", names };
    }
    if (this.eat("array")) {
      this.expect("[", 92);
      const index: TypeExpr[] = [];
      do index.push(this.indexType());
      while (this.eat(","));
      this.expect("]", 93);
      if (!this.eat("of")) compileError(5, this.peek().line, "Write array[1..10] of integer.");
      return { k: "array", index, of: this.typeExpr() };
    }
    if (this.eat("record")) {
      const fields: { names: string[]; t: TypeExpr }[] = [];
      while (!this.is("end")) {
        if (this.peek().t === "eof") compileError(10, this.peek().line);
        const names = [this.ident()];
        while (this.eat(",")) names.push(this.ident());
        this.expect(":", 86);
        fields.push({ names, t: this.typeExpr() });
        if (!this.eat(";") && !this.is("end")) compileError(85, this.toks[this.i - 1].line);
      }
      this.next();
      return { k: "record", fields };
    }
    if (this.eat("set")) {
      if (!this.eat("of")) compileError(5, this.peek().line, "Write set of char.");
      return { k: "set", of: this.indexType() };
    }
    if (this.eat("text")) return { k: "text" };
    if (this.eat("file")) {
      if (!this.eat("of")) compileError(5, this.peek().line, "Write file of and the type of one record, like file of TBook. (For text, use text.)");
      return { k: "file", of: this.typeExpr() };
    }
    // A name, or a subrange like 1..10 or 'a'..'z'
    if (t.t === "id" && !this.is("..", 1)) {
      this.next();
      if (t.v === "text") return { k: "text" };
      return { k: "named", name: t.v, line: t.line };
    }
    return this.indexType();
  }

  indexType(): TypeExpr {
    const t = this.peek();
    if (t.t === "id" && !this.is("..", 1)) {
      this.next();
      return { k: "named", name: t.v, line: t.line };
    }
    if (this.is("(")) return this.typeExpr();
    const lo = this.expr();
    if (!this.eat("..")) compileError(5, this.peek().line, "A range is written like 1..10.");
    const hi = this.expr();
    return { k: "sub", lo, hi };
  }

  // The value of a typed constant: an expression, or a list in brackets for an array: (1, 2, 3)
  initValue(): Expr {
    if (this.is("(")) {
      // look ahead: a comma inside the outer brackets means a list
      let depth = 0;
      for (let k = this.i; k < this.toks.length; k++) {
        const v = this.toks[k].v;
        if (this.toks[k].t !== "op") continue;
        if (v === "(") depth++;
        else if (v === ")") {
          depth--;
          if (depth === 0) break;
        } else if (v === "," && depth === 1) {
          const line = this.peek().line;
          this.next();
          const items: Expr[] = [];
          do items.push(this.initValue());
          while (this.eat(","));
          this.expect(")", 89);
          return { k: "list", items, line };
        }
      }
    }
    return this.expr();
  }

  // ----- statements -----

  compound(): Stmt & { k: "block" } {
    const line = this.peek().line;
    this.expect("begin", 36);
    const body = this.statements(["end"]);
    this.expect("end", 37);
    return { k: "block", body, line };
  }

  // Statements separated by semicolons, until one of the end words
  statements(ends: string[]): Stmt[] {
    const list: Stmt[] = [];
    while (true) {
      if (ends.some((e) => this.is(e))) break;
      list.push(this.statement());
      if (this.eat(";")) continue;
      if (ends.some((e) => this.is(e))) break;
      const t = this.peek();
      if (t.t === "eof") compileError(10, t.line);
      if (this.is("else")) compileError(113, t.line);
      compileError(85, this.toks[this.i - 1].line);
    }
    return list;
  }

  statement(): Stmt {
    const t = this.peek();
    const line = t.line;
    if (this.is(";") || this.is("end") || this.is("until")) return { k: "empty", line };
    if (this.is("else")) compileError(113, line, "There must be no ; before ELSE.");
    if (this.is("begin")) return this.compound();
    if (this.eat("if")) {
      const cond = this.expr();
      if (this.is(":=")) compileError(57, this.peek().line, "To compare, use = . := only stores a value.");
      if (!this.eat("then")) compileError(57, this.peek().line);
      const then = this.is("else") ? ({ k: "empty", line } as Stmt) : this.statement();
      let other: Stmt | null = null;
      if (this.eat("else")) other = this.statement();
      return { k: "if", cond, then, else: other, line };
    }
    if (this.eat("while")) {
      const cond = this.expr();
      if (!this.eat("do")) compileError(5, this.peek().line, "Write while … do.");
      return { k: "while", cond, body: this.statement(), line };
    }
    if (this.eat("repeat")) {
      const body = this.statements(["until"]);
      this.expect("until", 5);
      return { k: "repeat", body, cond: this.expr(), line };
    }
    if (this.eat("for")) {
      const v = this.ident();
      if (!this.eat(":=")) compileError(91, this.peek().line);
      const from = this.expr();
      let down = false;
      if (this.eat("downto")) down = true;
      else if (!this.eat("to")) compileError(58, this.peek().line);
      const to = this.expr();
      if (!this.eat("do")) compileError(5, this.peek().line, "Write for … do.");
      return { k: "for", v, from, to, down, body: this.statement(), line };
    }
    if (this.eat("case")) {
      const e = this.expr();
      if (!this.eat("of")) compileError(5, this.peek().line, "Write case … of.");
      const arms: Extract<Stmt, { k: "case" }>["arms"] = [];
      let other: Stmt[] | null = null;
      while (!this.is("end")) {
        if (this.eat("else") || this.eat("otherwise")) {
          other = this.statements(["end"]);
          break;
        }
        const labels: { lo: Expr; hi: Expr | null }[] = [];
        do {
          const lo = this.expr();
          labels.push({ lo, hi: this.eat("..") ? this.expr() : null });
        } while (this.eat(","));
        this.expect(":", 86);
        arms.push({ labels, body: this.statement() });
        if (!this.eat(";") && !this.is("end") && !this.is("else") && !this.is("otherwise")) compileError(85, this.toks[this.i - 1].line);
      }
      this.expect("end", 37);
      return { k: "case", e, arms, other, line };
    }
    if (this.eat("with")) {
      const recs = [this.designator()];
      while (this.eat(",")) recs.push(this.designator());
      if (!this.eat("do")) compileError(5, this.peek().line, "Write with … do.");
      return { k: "with", recs, body: this.statement(), line };
    }
    if (this.is("goto")) compileError(5, line, "GOTO isn't used in these lessons.");
    if (t.t === "id" && !KEYWORDS.has(t.v)) {
      const target = this.designator();
      if (this.is(":=")) {
        this.next();
        return { k: "assign", target, e: this.expr(), line };
      }
      if (this.is("=")) compileError(91, this.peek().line, "Assignment is := in Pascal. A single = only compares.");
      if (target.k === "id") return { k: "call", name: target.name, args: [], line };
      if (target.k === "call") return { k: "call", name: target.name, args: target.args, line };
      compileError(91, this.peek().line);
    }
    if (t.t === "eof") compileError(10, line);
    compileError(113, line);
  }

  // A variable, maybe with [index], .field and ^, or a call with arguments
  designator(): Expr {
    const t = this.peek();
    const line = t.line;
    const name = this.ident();
    let e: Expr = { k: "id", name, line };
    if (this.is("(")) {
      this.next();
      const args: Expr[] = [];
      if (!this.eat(")")) {
        do args.push(this.writeArg());
        while (this.eat(","));
        this.expect(")", 89);
      }
      e = { k: "call", name, args, line };
    }
    while (true) {
      if (this.eat("[")) {
        const index = [this.expr()];
        while (this.eat(",")) index.push(this.expr());
        this.expect("]", 93);
        e = { k: "idx", base: e, index, line };
      } else if (this.is(".") && this.peek(1).t === "id") {
        this.next();
        e = { k: "field", base: e, name: this.ident(), line };
      } else if (this.eat("^")) {
        e = { k: "deref", base: e, line };
      } else break;
    }
    return e;
  }

  // Arguments of write/writeln can have a width and decimals: x:8:2
  writeArg(): Expr {
    const e = this.expr();
    if (this.is(":")) {
      const line = this.peek().line;
      this.next();
      const width = this.expr();
      const decimals = this.eat(":") ? this.expr() : null;
      return { k: "fmt", e, width, decimals, line };
    }
    return e;
  }

  // ----- expressions (Pascal precedence: not > * / div mod and > + - or > comparisons) -----

  expr(): Expr {
    const l = this.simple();
    const t = this.peek();
    if (["=", "<>", "<", ">", "<=", ">="].includes(t.v) && t.t === "op") {
      this.next();
      const r = this.simple();
      const after = this.peek();
      if (after.t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(after.v))
        compileError(41, after.line, "Put each comparison in brackets: if (a > 1) and (a < 10) then …");
      return { k: "bin", op: t.v, l, r, line: t.line };
    }
    if (this.is("in")) {
      this.next();
      return { k: "bin", op: "in", l, r: this.simple(), line: t.line };
    }
    return l;
  }
  simple(): Expr {
    let e: Expr;
    const t = this.peek();
    if (t.t === "op" && (t.v === "-" || t.v === "+")) {
      this.next();
      const term = this.term();
      e = t.v === "-" ? { k: "un", op: "-", e: term, line: t.line } : term;
    } else e = this.term();
    while (true) {
      const o = this.peek();
      if ((o.t === "op" && (o.v === "+" || o.v === "-")) || this.is("or") || this.is("xor")) {
        this.next();
        e = { k: "bin", op: o.v, l: e, r: this.term(), line: o.line };
      } else return e;
    }
  }
  term(): Expr {
    let e = this.factor();
    while (true) {
      const o = this.peek();
      if ((o.t === "op" && (o.v === "*" || o.v === "/")) || ["div", "mod", "and", "shl", "shr"].some((w) => this.is(w))) {
        this.next();
        e = { k: "bin", op: o.v, l: e, r: this.factor(), line: o.line };
      } else return e;
    }
  }
  factor(): Expr {
    const t = this.peek();
    const line = t.line;
    if (t.t === "num") {
      this.next();
      return { k: "num", v: t.n!, real: !!t.real, line };
    }
    if (t.t === "str") {
      this.next();
      return { k: "str", v: t.v, line };
    }
    if (this.eat("nil")) return { k: "nil", line };
    if (this.eat("not")) return { k: "un", op: "not", e: this.factor(), line };
    if (this.eat("(")) {
      const e = this.expr();
      this.expect(")", 89);
      return e;
    }
    if (this.eat("[")) {
      const items: { lo: Expr; hi: Expr | null }[] = [];
      if (!this.eat("]")) {
        do {
          const lo = this.expr();
          items.push({ lo, hi: this.eat("..") ? this.expr() : null });
        } while (this.eat(","));
        this.expect("]", 93);
      }
      return { k: "set", items, line };
    }
    if (t.t === "id" && !KEYWORDS.has(t.v)) return this.designator();
    if (t.t === "eof") compileError(10, line);
    compileError(42, line);
  }
}

// ---------- Values and memory ----------

type Cell = { v: any };
type Ref = { get(): any; set(v: any): void; t: T };
type Pointer = { cell: Cell; t: T; alive: boolean } | null;
type FileVal = { name: string | null; mode: "closed" | "read" | "write"; pos: number; isFile: true; typed?: boolean };

type Entry =
  | { kind: "var"; cell: Cell; t: T }
  | { kind: "ref"; ref: Ref }
  | { kind: "const"; v: any; t: T }
  | { kind: "type"; t: T }
  | { kind: "routine"; r: Routine; env: Env }
  | { kind: "result"; r: Routine; cell: Cell; t: T };

class Env {
  map = new Map<string, Entry>();
  globalScope = false; // the program's or a unit's own variables: they start at 0
  withs: Ref[] = []; // records opened with WITH, innermost last
  constructor(public parent: Env | null) {}
  lookup(name: string): Entry | Ref | undefined {
    for (let e: Env | null = this; e; e = e.parent) {
      for (let w = e.withs.length - 1; w >= 0; w--) {
        const rec = e.withs[w];
        const rt = rec.t as T & { k: "record" };
        const f = rt.fields.find((x) => x.name === name);
        if (f) return fieldRef(rec, f.name, f.t);
      }
      const found = e.map.get(name);
      if (found) return found;
    }
    return undefined;
  }
}

function fieldRef(rec: Ref, name: string, t: T): Ref {
  return {
    t,
    get: () => rec.get()[name],
    set: (v) => {
      rec.get()[name] = v;
    },
  };
}

function defaultValue(t: T): any {
  switch (t.k) {
    case "int":
    case "real":
    case "enum":
      return 0;
    case "sub":
      return t.lo;
    case "bool":
      return false;
    case "char":
      return "\0";
    case "str":
      return "";
    case "array":
      return Array.from({ length: t.hi - t.lo + 1 }, () => defaultValue(t.of));
    case "record": {
      const o: Record<string, any> = {};
      for (const f of t.fields) o[f.name] = defaultValue(f.t);
      return o;
    }
    case "set":
      return new Set<number>();
    case "ptr":
    case "nil":
      return null;
    case "text":
      return { name: null, mode: "closed", pos: 0, isFile: true } as FileVal;
    case "file":
      return { name: null, mode: "closed", pos: 0, isFile: true, typed: true } as FileVal;
    default:
      return 0;
  }
}

// Pascal copies arrays and records when they are assigned or passed by value
function clone(v: any): any {
  if (Array.isArray(v)) return v.map(clone);
  if (v instanceof Set) return new Set(v);
  if (v && typeof v === "object" && !("cell" in v) && !("isFile" in v)) {
    const o: Record<string, any> = {};
    for (const k of Object.keys(v)) o[k] = clone(v[k]);
    return o;
  }
  return v;
}

const isRefObj = (x: any): x is Ref => x && typeof x.get === "function" && "t" in x;

// ---------- Number formatting like Turbo Pascal ----------

// write(x) for a real without a format: " 3.1400000000E+00" (17 characters)
function realScientific(x: number, digits = 10): string {
  if (!Number.isFinite(x)) return x > 0 ? " +INF" : x < 0 ? " -INF" : " NAN";
  const sign = x < 0 ? "-" : " ";
  let s = Math.abs(x).toExponential(digits); // "3.1400000000e+0"
  const [mant, exp] = s.split("e");
  const e = Number(exp);
  const es = (e < 0 ? "-" : "+") + String(Math.abs(e)).padStart(2, "0");
  return `${sign}${mant}E${es}`;
}

// x:0:2 → fixed decimals, rounded half away from zero like Turbo Pascal
function realFixed(x: number, decimals: number): string {
  const f = Math.pow(10, decimals);
  const r = Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9 * Math.abs(x) * f) / f;
  return (Object.is(r, -0) ? 0 : r).toFixed(decimals);
}

// ---------- The machine ----------

export const PASCAL_START_FILES: Record<string, string> = {
  "SCORES.TXT": "ADA 92\nKEN 78\nNIKLAUS 99\n",
  "README.TXT": "TURBO PASCAL 3.0\nCOPYRIGHT (C) 1983 BORLAND INC.\n",
};

type CallFrame = { r: Routine; env: Env };

class Machine {
  steps = 0;
  depth = 0;
  inPos = 0;
  seed = 1;
  garbage = 4711;
  files = new Map<string, string>(Object.entries(PASCAL_START_FILES));
  records = new Map<string, any[]>(); // typed files (file of …): one value per record
  // The crt screen: 80 × 25 characters. It's switched on by the first gotoxy;
  // until then, output simply scrolls like on a terminal.
  screen: string[][] | null = null;
  cx = 1;
  cy = 1;
  clearedAt = 0; // where the output was when clrscr was last called
  getOutput: () => string = () => "";
  crt = false; // uses crt
  stdinFile: FileVal = { name: null, mode: "read", pos: 0, isFile: true };

  constructor(
    public write: (s: string) => void,
    public stdin: string
  ) {}

  // ----- the screen -----
  startScreen(sofar: string) {
    this.screen = Array.from({ length: 25 }, () => Array(80).fill(" "));
    this.cx = 1;
    this.cy = 1;
    this.screenWrite(sofar);
  }
  screenWrite(text: string) {
    const scr = this.screen!;
    for (const c of text) {
      if (c === "\n") {
        this.cx = 1;
        this.cy++;
      } else {
        if (this.cx > 80) {
          this.cx = 1;
          this.cy++;
        }
        if (this.cy > 25) this.scroll();
        scr[this.cy - 1][this.cx - 1] = c;
        this.cx++;
      }
      if (this.cy > 25) this.scroll();
    }
  }
  scroll() {
    this.screen!.shift();
    this.screen!.push(Array(80).fill(" "));
    this.cy = 25;
  }
  screenText(): string {
    const rows = this.screen!.map((r) => r.join("").replace(/\s+$/, ""));
    while (rows.length && rows[rows.length - 1] === "") rows.pop();
    return rows.join("\n") + (rows.length ? "\n" : "");
  }

  step(line: number) {
    if (++this.steps > MAX_STEPS) throw new RuntimeError(`Time limit exceeded: the program never stopped (line ${line}). Check your loops.`);
  }

  // ----- types -----
  resolveType(te: TypeExpr, env: Env, name?: string): T {
    switch (te.k) {
      case "named": {
        const builtIn = builtinType(te.name);
        if (builtIn) return builtIn;
        const e = env.lookup(te.name);
        if (!e || isRefObj(e) || (e as Entry).kind !== "type") compileError(3, te.line, `There is no type called ${te.name}.`);
        return (e as Entry & { kind: "type" }).t;
      }
      case "string": {
        if (!te.max) return STRING;
        const n = this.constValue(te.max, env);
        if (typeof n !== "number" || n < 1 || n > 255) compileError(76, exprLine(te.max), "A string can hold 1 to 255 characters.");
        return { k: "str", max: n };
      }
      case "enum": {
        const t: T = { k: "enum", name: name ?? "enumeration", names: te.names };
        te.names.forEach((n, i) => env.map.set(n, { kind: "const", v: i, t }));
        return t;
      }
      case "sub": {
        const lo = this.evalConst(te.lo, env);
        const hi = this.evalConst(te.hi, env);
        if (!isOrdinal(lo.t) || !isOrdinal(hi.t)) compileError(31, exprLine(te.lo), "A range needs whole numbers, characters or enumeration values.");
        const b = base(lo.t);
        const lov = ordOf(lo.v, lo.t);
        const hiv = ordOf(hi.v, hi.t);
        if (hiv < lov) compileError(76, exprLine(te.lo), "The upper bound is smaller than the lower bound.");
        return { k: "sub", base: b.k === "int" ? INTEGER : b, lo: lov, hi: hiv };
      }
      case "array": {
        if (te.index.length === 0) return { k: "array", index: INTEGER, lo: 0, hi: -1, of: this.resolveType(te.of, env) };
        let inner = this.resolveType(te.of, env);
        for (let d = te.index.length - 1; d >= 0; d--) {
          const it = this.resolveType(te.index[d], env);
          if (!isOrdinal(it)) compileError(26, 0, "An array index must be a range like 1..10.");
          const lo = ordLow(it);
          const hi = ordHigh(it);
          if (hi - lo > 100000) compileError(22, 0, "This array is too big.");
          inner = { k: "array", index: it, lo, hi, of: inner };
        }
        return inner;
      }
      case "record": {
        const fields: { name: string; t: T }[] = [];
        for (const f of te.fields) {
          const t = this.resolveType(f.t, env);
          for (const n of f.names) {
            if (fields.some((x) => x.name === n)) compileError(4, 0, `The field ${n} is there twice.`);
            fields.push({ name: n, t });
          }
        }
        return { k: "record", name: name ?? "record", fields };
      }
      case "set": {
        const of = this.resolveType(te.of, env);
        if (!isOrdinal(of)) compileError(26, 0, "Sets hold ordinal values, like char or 0..255.");
        return { k: "set", of };
      }
      case "ptr":
        return { k: "ptr", to: null, toName: te.to, env, name };
      case "text":
        return { k: "text" };
      case "file": {
        const of = this.resolveType(te.of, env);
        if (of.k === "text" || of.k === "file" || of.k === "ptr") compileError(26, 0, "A typed file holds plain values or records, not files or pointers.");
        return { k: "file", of };
      }
    }
  }

  // A pointer's target type is looked up when it is first needed, so a pointer can point to a
  // record that is declared further down (type PNode = ^TNode; TNode = record … end;)
  ptrTarget(t: T & { k: "ptr" }, line: number): T {
    if (t.to) return t.to;
    const b = builtinType(t.toName!);
    if (b) return (t.to = b);
    const e = t.env!.lookup(t.toName!);
    if (!e || isRefObj(e) || (e as Entry).kind !== "type") compileError(3, line, `There is no type called ${t.toName}.`);
    return (t.to = (e as Entry & { kind: "type" }).t);
  }

  constValue(e: Expr, env: Env): any {
    return this.evalConst(e, env).v;
  }
  evalConst(e: Expr, env: Env): { t: T; v: any } {
    const saved = this.steps;
    const r = this.eval(e, env);
    this.steps = saved;
    return r;
  }

  // ----- declarations -----
  declare(block: { decls: Decl[] }, env: Env, checkForward = true) {
    for (const d of block.decls) {
      if (d.k === "const") {
        if (env.map.has(d.name)) compileError(4, d.line);
        const c = this.evalConst(d.e, env);
        env.map.set(d.name, { kind: "const", v: c.v, t: c.t });
      } else if (d.k === "type") {
        if (env.map.has(d.name)) compileError(4, d.line);
        env.map.set(d.name, { kind: "type", t: this.resolveType(d.t, env, d.name) });
      } else if (d.k === "var") {
        const t = this.resolveType(d.t, env);
        for (const n of d.names) {
          if (env.map.has(n)) compileError(4, d.line, `${n} is declared twice.`);
          const cell: Cell = { v: defaultValue(t) };
          // Like in Turbo Pascal, global variables start at 0, but local ones hold whatever was left on the stack
          if (env.parent && !env.globalScope && !d.init) {
            this.garbage = (this.garbage * 1103515245 + 12345) & 0x7fff;
            const bt = base(t);
            if (bt.k === "int") cell.v = wrapInt(this.garbage * 7 - 9000, bt);
            else if (t.k === "real") cell.v = (this.garbage % 997) / 7.3;
          }
          env.map.set(n, { kind: "var", cell, t });
          if (d.init) cell.v = this.initFrom(d.init, t, env, d.line);
        }
      } else {
        const r = d.r;
        const existing = env.map.get(r.name);
        if (existing && existing.kind === "routine" && !existing.r.block && r.block) {
          // the body of a forward declaration
          existing.r.block = r.block;
          if (r.params.length === 0 && existing.r.params.length > 0) continue;
          if (r.params.length !== existing.r.params.length) compileError(131, r.line);
          continue;
        }
        if (existing) compileError(4, r.line, `${r.name} is declared twice.`);
        if (r.kind === "function" && !r.ret) compileError(86, r.line, "A function needs a result type, like : integer");
        env.map.set(r.name, { kind: "routine", r, env });
      }
    }
    if (checkForward)
      for (const [, e] of env.map) if (e.kind === "routine" && !e.r.block) compileError(5, e.r.line, `The forward declaration of ${e.r.name} has no body.`);
  }

  initFrom(e: Expr, t: T, env: Env, line: number): any {
    if (e.k !== "list") return this.convert(this.eval(e, env), t, line);
    if (t.k !== "array") compileError(26, line, "A list in brackets needs an array type.");
    const n = t.hi - t.lo + 1;
    if (e.items.length !== n) compileError(26, line, `The array has ${n} elements, but the list has ${e.items.length}.`);
    return e.items.map((item) => this.initFrom(item, t.of, env, line));
  }

  // ----- statements -----
  exec(s: Stmt, env: Env): void {
    this.step(s.line);
    switch (s.k) {
      case "empty":
        return;
      case "block":
        for (const x of s.body) this.exec(x, env);
        return;
      case "assign": {
        const target = this.lvalue(s.target, env, true);
        const v = this.eval(s.e, env);
        target.set(this.convert(v, target.t, s.line));
        return;
      }
      case "call":
        this.callStatement(s.name, s.args, env, s.line);
        return;
      case "if":
        if (this.cond(s.cond, env)) this.exec(s.then, env);
        else if (s.else) this.exec(s.else, env);
        return;
      case "while":
        while (this.cond(s.cond, env)) {
          try {
            this.exec(s.body, env);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      case "repeat":
        while (true) {
          let stop = false;
          try {
            for (const x of s.body) this.exec(x, env);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (!(e instanceof ContinueSignal)) throw e;
          }
          stop = this.cond(s.cond, env);
          if (stop) break;
        }
        return;
      case "for": {
        const v = this.lvalue({ k: "id", name: s.v, line: s.line }, env, true);
        if (!isOrdinal(v.t)) compileError(97, s.line, "The loop variable must be an integer, char or other ordinal type.");
        const from = this.convert(this.eval(s.from, env), v.t, s.line);
        const to = this.convert(this.eval(s.to, env), v.t, s.line);
        let i = ordOf(from, v.t);
        const end = ordOf(to, v.t);
        while (s.down ? i >= end : i <= end) {
          v.set(fromOrd(i, v.t));
          try {
            this.exec(s.body, env);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (!(e instanceof ContinueSignal)) throw e;
          }
          this.step(s.line);
          i += s.down ? -1 : 1;
        }
        return;
      }
      case "case": {
        const v = this.eval(s.e, env);
        if (!isOrdinal(v.t)) compileError(26, s.line, "CASE works with integers, characters and other ordinal values, not with strings or reals.");
        const o = ordOf(v.v, v.t);
        for (const arm of s.arms) {
          for (const l of arm.labels) {
            const lo = this.eval(l.lo, env);
            if (!isOrdinal(lo.t) || base(lo.t).k !== base(v.t).k) compileError(74, exprLine(l.lo));
            const hi = l.hi ? ordOf(this.eval(l.hi, env).v, lo.t) : ordOf(lo.v, lo.t);
            if (o >= ordOf(lo.v, lo.t) && o <= hi) {
              this.exec(arm.body, env);
              return;
            }
          }
        }
        if (s.other) for (const x of s.other) this.exec(x, env);
        return;
      }
      case "with": {
        const added: Ref[] = [];
        for (const r of s.recs) {
          const ref = this.lvalue(r, env, false);
          if (ref.t.k !== "record") compileError(26, s.line, "WITH needs a record.");
          // fix the record now: later changes to an index don't move the WITH
          const target = ref.get();
          added.push({ t: ref.t, get: () => target, set: () => {} });
        }
        env.withs.push(...added);
        try {
          this.exec(s.body, env);
        } finally {
          env.withs.splice(env.withs.length - added.length, added.length);
        }
        return;
      }
    }
  }

  cond(e: Expr, env: Env): boolean {
    const v = this.eval(e, env);
    if (v.t.k !== "bool") compileError(26, exprLine(e), "The condition must be true or false (a boolean).");
    return v.v;
  }

  // ----- variables -----
  lvalue(e: Expr, env: Env, forWrite: boolean): Ref {
    switch (e.k) {
      case "id": {
        const found = env.lookup(e.name);
        if (!found) compileError(3, e.line, `${e.name} isn't declared. Add it to the var section.`);
        if (isRefObj(found)) return found;
        switch (found.kind) {
          case "var":
            return { t: found.t, get: () => found.cell.v, set: (v) => (found.cell.v = v) };
          case "ref":
            return found.ref;
          case "result":
            return { t: found.t, get: () => found.cell.v, set: (v) => (found.cell.v = v) };
          case "const":
            if (forWrite) compileError(122, e.line, `${e.name} is a constant: it can't be changed.`);
            return { t: found.t, get: () => found.v, set: () => {} };
          case "routine": {
            if (forWrite) compileError(122, e.line, `You can only assign to ${e.name} inside the function itself.`);
            const v = this.callRoutine(found.r, found.env, [], env, e.line);
            return { t: v.t, get: () => v.v, set: () => {} };
          }
          default:
            compileError(20, e.line);
        }
      }
      case "idx": {
        let ref = this.lvalue(e.base, env, forWrite);
        for (const ix of e.index) {
          const t = ref.t;
          const iv = this.eval(ix, env);
          if (t.k === "str") {
            if (!isInt(iv.t)) compileError(26, e.line, "A string index must be a whole number.");
            const s = ref;
            const i = iv.v;
            const strNow = s.get() as string;
            if (i < 1 || i > Math.max(strNow.length, forWrite ? (t as { max: number }).max : 0)) {
              if (i === 0) compileError(5, e.line, "s[0] is the hidden length byte: use length(s) instead.");
              runtimeError(201, `Range check error: ${i} is outside the string (it has ${strNow.length} characters).`, e.line);
            }
            ref = {
              t: CHAR,
              get: () => (s.get() as string)[i - 1] ?? "\0",
              set: (c) => {
                const cur = s.get() as string;
                s.set(cur.slice(0, i - 1).padEnd(i - 1, " ") + c + cur.slice(i));
              },
            };
            continue;
          }
          if (t.k !== "array") compileError(26, e.line, "Only arrays and strings have [ ].");
          if (!isOrdinal(iv.t)) compileError(26, e.line, "The index must be an integer (or another ordinal type).");
          const i = ordOf(iv.v, iv.t);
          const arrT = t;
          if (arrT.hi < arrT.lo) {
            // open array parameter: 0-based, its length is decided by the argument
            const arr = ref.get() as any[];
            if (i < 0 || i >= arr.length) runtimeError(201, `Range check error: index ${i} is outside 0..${arr.length - 1}.`, e.line);
            const a2 = ref;
            ref = { t: arrT.of, get: () => (a2.get() as any[])[i], set: (v) => ((a2.get() as any[])[i] = v) };
            continue;
          }
          if (i < arrT.lo || i > arrT.hi)
            runtimeError(201, `Range check error: index ${showOrd(i, arrT.index)} is outside ${showOrd(arrT.lo, arrT.index)}..${showOrd(arrT.hi, arrT.index)}.`, e.line);
          const a = ref;
          ref = { t: arrT.of, get: () => (a.get() as any[])[i - arrT.lo], set: (v) => ((a.get() as any[])[i - arrT.lo] = v) };
        }
        return ref;
      }
      case "field": {
        const rec = this.lvalue(e.base, env, forWrite);
        if (rec.t.k !== "record") {
          if (rec.t.k === "ptr") compileError(26, e.line, `${showExpr(e.base)} is a pointer: write ${showExpr(e.base)}^.${e.name}`);
          compileError(26, e.line, "Only records have fields.");
        }
        const f = rec.t.fields.find((x) => x.name === e.name);
        if (!f) compileError(3, e.line, `The record has no field called ${e.name}.`);
        return fieldRef(rec, f.name, f.t);
      }
      case "deref": {
        const p = this.eval(e.base, env);
        if (p.t.k !== "ptr") compileError(123, e.line);
        const ptr = p.v as Pointer;
        if (ptr === null) runtimeError(216, `General protection fault: ${showExpr(e.base)} is NIL, it doesn't point to anything.`, e.line);
        if (!ptr.alive) runtimeError(204, `Invalid pointer operation: ${showExpr(e.base)} points to memory that was already freed with dispose.`, e.line);
        const target = this.ptrTarget(p.t, e.line);
        return { t: target, get: () => ptr.cell.v, set: (v) => (ptr.cell.v = v) };
      }
      case "call": {
        const v = this.eval(e, env);
        if (forWrite) compileError(122, e.line);
        return { t: v.t, get: () => v.v, set: () => {} };
      }
      default:
        if (forWrite) compileError(122, exprLine(e));
        const v = this.eval(e, env);
        return { t: v.t, get: () => v.v, set: () => {} };
    }
  }

  // ----- conversions -----
  // Checks that a value fits where it's stored, and turns integers into reals and chars into strings
  convert(val: { t: T; v: any }, t: T, line: number): any {
    const from = val.t;
    switch (t.k) {
      case "int":
        if (!isInt(from)) {
          if (from.k === "real") compileError(26, line, "A real number can't go into an integer: use round() or trunc().");
          compileError(26, line, `${typeName(from)} can't go into ${typeName(t)}.`);
        }
        return wrapInt(val.v, t);
      case "real":
        if (!isNumeric(from)) compileError(26, line, `${typeName(from)} can't go into REAL.`);
        return val.v;
      case "bool":
        if (from.k !== "bool") compileError(26, line, `${typeName(from)} can't go into BOOLEAN.`);
        return val.v;
      case "char":
        if (from.k === "char") return val.v;
        if (from.k === "str" && val.v.length === 1) return val.v;
        compileError(26, line, from.k === "str" ? "A string can't go into a CHAR." : `${typeName(from)} can't go into CHAR.`);
      case "str": {
        if (!isStringy(from)) compileError(26, line, `${typeName(from)} can't go into a STRING. Use str() to turn a number into text.`);
        const s = val.v as string;
        return s.length > t.max ? s.slice(0, t.max) : s;
      }
      case "enum":
        if (base(from).k !== "enum" || (base(from) as { name: string }).name !== t.name) compileError(26, line);
        return val.v;
      case "sub": {
        const v = this.convert(val, t.base, line);
        const o = ordOf(v, t.base);
        if (o < t.lo || o > t.hi) runtimeError(201, `Range check error: ${showOrd(o, t.base)} is outside ${showOrd(t.lo, t.base)}..${showOrd(t.hi, t.base)}.`, line);
        return v;
      }
      case "array":
      case "record":
        if (from !== t) {
          if (from.k === t.k && t.k === "array" && sameShape(from, t)) return clone(val.v);
          compileError(26, line, "Both sides must have the same declared type.");
        }
        return clone(val.v);
      case "set":
        if (from.k !== "set") compileError(26, line);
        return new Set(val.v);
      case "ptr":
        if (from.k === "nil") return null;
        if (from.k !== "ptr") compileError(26, line, `${typeName(from)} can't go into a pointer.`);
        return val.v;
      case "text":
      case "file":
        compileError(26, line, "Files can't be assigned. Use assign(f, 'NAME.TXT').");
      default:
        return val.v;
    }
  }

  // ----- expressions -----
  eval(e: Expr, env: Env): { t: T; v: any } {
    this.step(exprLine(e));
    switch (e.k) {
      case "num":
        if (e.real) return { t: REAL, v: e.v };
        return { t: e.v >= -32768 && e.v <= 32767 ? INTEGER : LONGINT, v: e.v };
      case "str":
        return { t: e.v.length === 1 ? CHAR : STRING, v: e.v };
      case "nil":
        return { t: NIL, v: null };
      case "id": {
        const found = env.lookup(e.name);
        if (!found) {
          const b = BUILTIN_CONSTS[e.name];
          if (b) return b;
          if (BUILTINS[e.name]) return this.callBuiltin(e.name, [], env, e.line);
          compileError(3, e.line, `${e.name} isn't declared. Add it to the var section.`);
        }
        if (isRefObj(found)) return { t: found.t, v: found.get() };
        switch (found.kind) {
          case "var":
            return { t: found.t, v: found.cell.v };
          case "ref":
            return { t: found.ref.t, v: found.ref.get() };
          case "const":
            return { t: found.t, v: found.v };
          case "routine":
            return this.callRoutine(found.r, found.env, [], env, e.line);
          case "result":
            // inside a function, its name without arguments calls it again (recursion)
            return this.callRoutine(found.r, this.routineEnv(found.r, env), [], env, e.line);
          case "type":
            compileError(20, e.line, `${e.name} is a type, not a variable.`);
        }
        break;
      }
      case "call": {
        const found = env.lookup(e.name);
        if (found && !isRefObj(found)) {
          if (found.kind === "routine") {
            if (found.r.kind === "procedure") compileError(26, e.line, `${e.name} is a procedure: it gives back no value.`);
            return this.callRoutine(found.r, found.env, e.args, env, e.line);
          }
          if (found.kind === "result") return this.callRoutine(found.r, this.routineEnv(found.r, env), e.args, env, e.line);
          if (found.kind === "type") return this.typeCast(found.t, e, env);
        }
        if (BUILTINS[e.name]) return this.callBuiltin(e.name, e.args, env, e.line);
        if (BUILTIN_PROCS[e.name]) compileError(26, e.line, `${e.name} is a procedure: it gives back no value. Call it on its own, like ${e.name}(…);`);
        const castT = builtinType(e.name);
        if (castT) return this.typeCast(castT, e, env);
        compileError(3, e.line, `There is no function called ${e.name}.`);
      }
      case "idx":
      case "field":
      case "deref": {
        const ref = this.lvalue(e, env, false);
        return { t: ref.t, v: ref.get() };
      }
      case "set": {
        const s = new Set<number>();
        let of: T = INTEGER;
        for (const item of e.items) {
          const lo = this.eval(item.lo, env);
          if (!isOrdinal(lo.t)) compileError(26, e.line, "Sets hold ordinal values, like characters or small integers.");
          of = base(lo.t);
          const a = ordOf(lo.v, lo.t);
          const b = item.hi ? ordOf(this.eval(item.hi, env).v, lo.t) : a;
          if (a < 0 || b > 255) runtimeError(201, "Range check error: sets can only hold values 0..255.", e.line);
          for (let k = a; k <= b; k++) s.add(k);
        }
        return { t: { k: "set", of }, v: s };
      }
      case "un": {
        const v = this.eval(e.e, env);
        if (e.op === "-") {
          if (!isNumeric(v.t)) compileError(41, e.line);
          return { t: v.t.k === "real" ? REAL : intResult(base(v.t), base(v.t)), v: -v.v };
        }
        // not
        if (v.t.k === "bool") return { t: BOOL, v: !v.v };
        if (isInt(v.t)) return { t: base(v.t), v: wrapInt(~v.v, base(v.t)) };
        compileError(41, e.line);
      }
      case "bin":
        return this.binary(e, env);
      case "fmt":
        compileError(5, e.line, "Width and decimals (x:8:2) only work in write and writeln.");
      case "list":
        compileError(26, e.line, "A list in brackets only works as the value of an array constant.");
    }
    compileError(42, exprLine(e));
  }

  // For a function name used inside its own body: call it again with the routine's own scope
  routineEnv(r: Routine, env: Env): Env {
    for (let e: Env | null = env; e; e = e.parent) {
      const found = e.map.get(r.name);
      if (found && found.kind === "routine") return found.env;
    }
    return env;
  }

  typeCast(t: T, e: Expr & { k: "call" }, env: Env): { t: T; v: any } {
    if (e.args.length !== 1) compileError(89, e.line);
    const v = this.eval(e.args[0], env);
    if (isOrdinal(t) && isOrdinal(v.t)) {
      const o = ordOf(v.v, v.t);
      return { t, v: fromOrd(t.k === "int" ? wrapInt(o, t) : o, t) };
    }
    compileError(26, e.line);
  }

  binary(e: Expr & { k: "bin" }, env: Env): { t: T; v: any } {
    const op = e.op;
    // and/or don't evaluate the right side when the left one already decides (like Turbo Pascal's default)
    if (op === "and" || op === "or") {
      const l = this.eval(e.l, env);
      if (l.t.k === "bool") {
        if (op === "and" && !l.v) return { t: BOOL, v: false };
        if (op === "or" && l.v) return { t: BOOL, v: true };
        const r = this.eval(e.r, env);
        if (r.t.k !== "bool") compileError(41, e.line);
        return { t: BOOL, v: r.v };
      }
      const r = this.eval(e.r, env);
      if (isInt(l.t) && isInt(r.t)) {
        const t = intResult(base(l.t), base(r.t));
        return { t, v: wrapInt(op === "and" ? l.v & r.v : l.v | r.v, t) };
      }
      compileError(41, e.line, op === "and" || op === "or" ? "Put comparisons in brackets: (a > 1) and (b < 5)." : undefined);
    }
    const l = this.eval(e.l, env);
    const r = this.eval(e.r, env);
    const lt = base(l.t);
    const rt = base(r.t);
    switch (op) {
      case "+":
        if (isStringy(lt) && isStringy(rt)) {
          const s = (l.v as string) + (r.v as string);
          return { t: STRING, v: s.slice(0, 255) };
        }
        if (lt.k === "set" && rt.k === "set") return { t: lt, v: new Set([...l.v, ...r.v]) };
      // falls through
      case "-":
      case "*": {
        if (lt.k === "set" && rt.k === "set") {
          const a = l.v as Set<number>;
          const b = r.v as Set<number>;
          return { t: lt, v: new Set([...a].filter((x) => (op === "-" ? !b.has(x) : b.has(x)))) };
        }
        if (!isNumeric(lt) || !isNumeric(rt)) {
          if (isStringy(lt) || isStringy(rt)) compileError(41, e.line, op === "+" ? "You can't add text and a number: use str() to turn the number into text." : undefined);
          compileError(41, e.line);
        }
        const v = op === "+" ? l.v + r.v : op === "-" ? l.v - r.v : l.v * r.v;
        if (lt.k === "real" || rt.k === "real") return { t: REAL, v };
        const t = intResult(lt, rt);
        return { t, v: wrapInt(v, t) };
      }
      case "/":
        if (!isNumeric(lt) || !isNumeric(rt)) compileError(41, e.line);
        if (r.v === 0) runtimeError(200, "Division by zero.", e.line);
        return { t: REAL, v: l.v / r.v };
      case "div":
      case "mod": {
        if (!isInt(lt) || !isInt(rt)) compileError(41, e.line, lt.k === "real" || rt.k === "real" ? "div and mod only work with whole numbers. For reals use /." : undefined);
        if (r.v === 0) runtimeError(200, "Division by zero.", e.line);
        const t = intResult(lt, rt);
        return { t, v: wrapInt(op === "div" ? Math.trunc(l.v / r.v) : l.v % r.v, t) };
      }
      case "xor":
        if (lt.k === "bool" && rt.k === "bool") return { t: BOOL, v: l.v !== r.v };
        if (isInt(lt) && isInt(rt)) return { t: intResult(lt, rt), v: wrapInt(l.v ^ r.v, intResult(lt, rt)) };
        compileError(41, e.line);
      case "shl":
      case "shr": {
        if (!isInt(lt) || !isInt(rt)) compileError(41, e.line);
        const t = intResult(lt, rt);
        const bits = t.k === "int" && (t.name === "longint") ? 32 : 16;
        const mask = bits === 32 ? 0xffffffff : 0xffff;
        const u = (l.v & mask) >>> 0;
        const v = op === "shl" ? (u << r.v) & mask : u >>> r.v;
        return { t, v: wrapInt(v, t) };
      }
      case "in": {
        if (rt.k !== "set") compileError(26, e.line, "The right side of IN must be a set, like ['a'..'z'].");
        if (!isOrdinal(lt)) compileError(26, e.line);
        return { t: BOOL, v: (r.v as Set<number>).has(ordOf(l.v, l.t)) };
      }
      default: {
        // comparisons
        let a = l.v;
        let b = r.v;
        if (lt.k === "set" && rt.k === "set") {
          const sa = a as Set<number>;
          const sb = b as Set<number>;
          const sub = (x: Set<number>, y: Set<number>) => [...x].every((k) => y.has(k));
          if (op === "=") return { t: BOOL, v: sub(sa, sb) && sub(sb, sa) };
          if (op === "<>") return { t: BOOL, v: !(sub(sa, sb) && sub(sb, sa)) };
          if (op === "<=") return { t: BOOL, v: sub(sa, sb) };
          if (op === ">=") return { t: BOOL, v: sub(sb, sa) };
          compileError(41, e.line);
        }
        if ((lt.k === "ptr" || lt.k === "nil") && (rt.k === "ptr" || rt.k === "nil")) {
          if (op === "=") return { t: BOOL, v: a === b };
          if (op === "<>") return { t: BOOL, v: a !== b };
          compileError(41, e.line);
        }
        const ok =
          (isNumeric(lt) && isNumeric(rt)) ||
          (isStringy(lt) && isStringy(rt)) ||
          (lt.k === "bool" && rt.k === "bool") ||
          (lt.k === "enum" && rt.k === "enum" && lt.name === rt.name);
        if (!ok) {
          if ((isNumeric(lt) && isStringy(rt)) || (isStringy(lt) && isNumeric(rt))) compileError(26, e.line, "A number can't be compared with text.");
          if (lt.k === "array" || lt.k === "record") compileError(41, e.line, "Arrays and records can't be compared as a whole: compare them part by part.");
          compileError(41, e.line);
        }
        if (lt.k === "bool") {
          a = a ? 1 : 0;
          b = b ? 1 : 0;
        }
        const cmp = a < b ? -1 : a > b ? 1 : 0;
        const v = op === "=" ? cmp === 0 : op === "<>" ? cmp !== 0 : op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : cmp >= 0;
        return { t: BOOL, v };
      }
    }
  }

  // ----- calls -----
  callStatement(name: string, args: Expr[], env: Env, line: number) {
    const found = env.lookup(name);
    if (found && !isRefObj(found)) {
      if (found.kind === "routine") {
        this.callRoutine(found.r, found.env, args, env, line); // a function's result may be ignored (extended syntax)
        return;
      }
      if (found.kind === "result") {
        this.callRoutine(found.r, this.routineEnv(found.r, env), args, env, line);
        return;
      }
      compileError(113, line, `${name} is not a procedure. To change a variable, write ${name} := …`);
    }
    if (BUILTIN_PROCS[name] || BUILTINS[name]) {
      this.callBuiltin(name, args, env, line);
      return;
    }
    if (found) compileError(113, line);
    compileError(3, line, `There is no procedure called ${name}.`);
  }

  callRoutine(r: Routine, defEnv: Env, args: Expr[], callerEnv: Env, line: number): { t: T; v: any } {
    if (args.length !== r.params.length)
      compileError(r.params.length > args.length ? 89 : 89, line, `${r.name} needs ${r.params.length} parameter${r.params.length === 1 ? "" : "s"}, not ${args.length}.`);
    const env = new Env(defEnv);
    // the arguments are worked out in the caller's scope, before entering
    r.params.forEach((p, i) => {
      const a = args[i];
      if (a.k === "fmt") compileError(5, a.line);
      const pt = p.t ? this.resolveType(p.t, defEnv) : null;
      if (p.mode === "var") {
        if (!(a.k === "id" || a.k === "idx" || a.k === "field" || a.k === "deref")) compileError(20, line, `${p.name} is a VAR parameter: pass a variable, not a value.`);
        const ref = this.lvalue(a, callerEnv, true);
        if (pt && !sameType(ref.t, pt)) {
          compileError(26, line, `The VAR parameter ${p.name} needs a variable of type ${typeName(pt)}, not ${typeName(ref.t)}.`);
        }
        env.map.set(p.name, { kind: "ref", ref: pt && pt.k === "array" && pt.hi < pt.lo ? { ...ref, t: { ...pt } } : ref });
      } else {
        const v = this.eval(a, callerEnv);
        let t = pt ?? v.t;
        let value: any;
        if (t.k === "array" && t.hi < t.lo) {
          // open array: any array with the right element type, numbered from 0
          if (v.t.k !== "array") compileError(26, line, `${p.name} needs an array.`);
          value = clone(v.v);
          t = { ...t };
        } else value = this.convert(v, t, line);
        env.map.set(p.name, { kind: "var", cell: { v: value }, t });
      }
    });
    if (++this.depth > MAX_DEPTH) runtimeError(202, "Stack overflow. Does a routine call itself forever?", line);
    let result: Cell | null = null;
    let rt: T = VOID;
    if (r.kind === "function") {
      rt = this.resolveType(r.ret!, defEnv);
      result = { v: defaultValue(rt) };
      env.map.set(r.name, { kind: "result", r, cell: result, t: rt });
    }
    try {
      this.declare(r.block!, env);
      for (const s of r.block!.body) this.exec(s, env);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    } finally {
      this.depth--;
    }
    return { t: rt, v: result ? result.v : 0 };
  }

  // ----- input -----
  peekc(): string | null {
    return this.inPos < this.stdin.length ? this.stdin[this.inPos] : null;
  }
  skipSpace() {
    while (this.inPos < this.stdin.length && /\s/.test(this.stdin[this.inPos])) this.inPos++;
  }
  // read(x) for one variable
  readInto(ref: Ref, line: number, from: string) {
    const t = base(ref.t);
    if (t.k === "int" || t.k === "real") {
      this.skipSpace();
      if (this.inPos >= this.stdin.length) runtimeError(100, `Read beyond end of ${from}: there is nothing left to read.`, line);
      const rest = this.stdin.slice(this.inPos);
      const m = t.k === "int" ? rest.match(/^[+-]?\d+/) : rest.match(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
      const after = m ? rest[m[0].length] : rest[0];
      if (!m || (after !== undefined && !/\s/.test(after))) {
        const word = rest.split(/\s/)[0];
        runtimeError(106, `Invalid numeric format: '${word}' is not a ${t.k === "int" ? "whole number" : "number"}.`, line);
      }
      this.inPos += m[0].length;
      ref.set(this.convert({ t: t.k === "int" ? LONGINT : REAL, v: Number(m[0]) }, ref.t, line));
      return;
    }
    if (t.k === "char") {
      if (this.inPos >= this.stdin.length) runtimeError(100, `Read beyond end of ${from}.`, line);
      let c = this.stdin[this.inPos++];
      if (c === "\n") c = "\r"; // at the end of a line, read(c) gives the line break (#13)
      ref.set(c);
      return;
    }
    if (t.k === "str") {
      // read(s) takes the rest of the line, without the line break
      let s = "";
      while (this.inPos < this.stdin.length && this.stdin[this.inPos] !== "\n") s += this.stdin[this.inPos++];
      ref.set(s.slice(0, t.max));
      return;
    }
    compileError(64, line);
  }
  skipLine() {
    while (this.inPos < this.stdin.length && this.stdin[this.inPos] !== "\n") this.inPos++;
    if (this.inPos < this.stdin.length) this.inPos++;
  }

  // Run a read with a text file as the input instead of the keyboard
  withFile<R>(f: FileVal, line: number, fn: () => R): R {
    if (f.mode !== "read") runtimeError(f.mode === "closed" ? 103 : 105, f.mode === "closed" ? "File not open. Call reset(f) first." : "File not open for input: it was opened with rewrite.", line);
    const saved = [this.stdin, this.inPos] as const;
    this.stdin = this.files.get(f.name!) ?? "";
    this.inPos = f.pos;
    try {
      return fn();
    } finally {
      f.pos = this.inPos;
      [this.stdin, this.inPos] = saved;
    }
  }

  // ----- typed files -----
  typedFile(f: FileVal, line: number): any[] {
    if (f.mode === "closed") runtimeError(103, "File not open. Call reset(f) or rewrite(f) first.", line);
    return this.records.get(f.name!)!;
  }

  // ----- builtins -----
  callBuiltin(name: string, args: Expr[], env: Env, line: number): { t: T; v: any } {
    if (CRT_ROUTINES.has(name) && !this.crt) compileError(3, line, `${name} comes from the crt unit. Add uses crt; after the program line.`);
    const fn = BUILTINS[name] ?? BUILTIN_PROCS[name];
    return fn(this, args, env, line) ?? { t: VOID, v: 0 };
  }

  formatValue(val: { t: T; v: any }, width: number | null, decimals: number | null, line: number): string {
    const t = base(val.t);
    let s: string;
    if (t.k === "real" || (decimals !== null && t.k === "int")) {
      if (decimals !== null && t.k === "int") compileError(5, line, "Only real numbers can have decimals: x:8:2 needs a real.");
      if (decimals !== null) s = realFixed(val.v, Math.max(0, decimals));
      else if (width !== null) {
        // write(x:12) shows fewer digits in scientific notation
        const digits = Math.max(1, Math.min(10, width - 7));
        s = realScientific(val.v, digits);
      } else s = realScientific(val.v);
    } else if (t.k === "int") s = String(val.v);
    else if (t.k === "bool") s = val.v ? "TRUE" : "FALSE";
    else if (t.k === "char" || t.k === "str") s = val.v;
    else if (t.k === "enum") compileError(64, line, "Enumeration values can't be written directly. Use a case or an array of names.");
    else compileError(64, line);
    if (width !== null && s.length < width) s = s.padStart(width, " ");
    return s;
  }
}

// ---------- Helpers ----------

function exprLine(e: Expr): number {
  return e.line;
}

function showExpr(e: Expr): string {
  switch (e.k) {
    case "id":
      return e.name;
    case "field":
      return `${showExpr(e.base)}.${e.name}`;
    case "deref":
      return `${showExpr(e.base)}^`;
    case "idx":
      return `${showExpr(e.base)}[…]`;
    default:
      return "it";
  }
}

function builtinType(name: string): T | null {
  if (name in INTS) return INTS[name as IntName];
  if (name === "real" || name === "double" || name === "single" || name === "extended") return REAL;
  if (name === "boolean") return BOOL;
  if (name === "char") return CHAR;
  if (name === "string") return STRING;
  if (name === "text") return { k: "text" };
  return null;
}

// integer op integer stays a 16-bit integer, like in Turbo Pascal; any longint makes it longint
function intResult(a: T, b: T): T {
  const big = (t: T) => t.k === "int" && (t.name === "longint" || t.name === "word");
  return big(a) || big(b) ? LONGINT : INTEGER;
}

function wrapInt(v: number, t: T): number {
  if (t.k !== "int") return v;
  v = Math.trunc(v);
  const span = t.hi - t.lo + 1;
  if (v >= t.lo && v <= t.hi) return v;
  return ((((v - t.lo) % span) + span) % span) + t.lo;
}

function ordOf(v: any, t: T): number {
  const b = base(t);
  if (b.k === "char") return (v as string).charCodeAt(0);
  if (b.k === "bool") return v ? 1 : 0;
  return v as number;
}
function fromOrd(o: number, t: T): any {
  const b = base(t);
  if (b.k === "char") return String.fromCharCode(o & 255);
  if (b.k === "bool") return o !== 0;
  return o;
}
function showOrd(o: number, t: T): string {
  const b = base(t);
  if (b.k === "char") return `'${String.fromCharCode(o)}'`;
  if (b.k === "enum") return b.names[o] ?? String(o);
  if (b.k === "bool") return o ? "TRUE" : "FALSE";
  return String(o);
}

function sameShape(a: T, b: T): boolean {
  if (a.k !== b.k) return false;
  if (a.k === "array" && b.k === "array") return a.lo === b.lo && a.hi === b.hi && sameType(a.of, b.of);
  return sameType(a, b);
}
function sameType(a: T, b: T): boolean {
  if (a === b) return true;
  if (a.k !== b.k) {
    if (a.k === "sub" || b.k === "sub") return sameType(base(a), base(b));
    return false;
  }
  if (a.k === "int" && b.k === "int") return a.name === b.name;
  if (a.k === "str" && b.k === "str") return true;
  if (a.k === "enum" && b.k === "enum") return a.name === b.name;
  if (a.k === "array" && b.k === "array") return (b.hi < b.lo || a.hi < a.lo || (a.lo === b.lo && a.hi === b.hi)) && sameType(a.of, b.of);
  if (a.k === "record" && b.k === "record") return a === b;
  if (a.k === "ptr" && b.k === "ptr") return a.toName === b.toName;
  return a.k === b.k;
}

// ---------- Built-in constants, functions and procedures ----------

const BUILTIN_CONSTS: Record<string, { t: T; v: any }> = {
  maxint: { t: INTEGER, v: 32767 },
  maxlongint: { t: LONGINT, v: 2147483647 },
  pi: { t: REAL, v: Math.PI },
  true: { t: BOOL, v: true },
  false: { t: BOOL, v: false },
};

type Builtin = (m: Machine, args: Expr[], env: Env, line: number) => { t: T; v: any } | void;

function argc(name: string, args: Expr[], n: number | [number, number], line: number) {
  const [lo, hi] = Array.isArray(n) ? n : [n, n];
  if (args.length < lo || args.length > hi) compileError(89, line, `${name} needs ${lo === hi ? lo : `${lo} to ${hi}`} parameter${hi === 1 ? "" : "s"}.`);
}
function num(m: Machine, e: Expr, env: Env, name: string) {
  const v = m.eval(e, env);
  if (!isNumeric(v.t)) compileError(40, e.line, `${name} needs a number.`);
  return v;
}
function intArg(m: Machine, e: Expr, env: Env, name: string): number {
  const v = m.eval(e, env);
  if (!isInt(v.t)) compileError(26, e.line, `${name} needs a whole number here.`);
  return v.v;
}
function strArg(m: Machine, e: Expr, env: Env, name: string): string {
  const v = m.eval(e, env);
  if (!isStringy(v.t)) compileError(26, e.line, `${name} needs a string here.`);
  return v.v;
}
function fileArg(m: Machine, e: Expr, env: Env, name: string, typed = false): FileVal {
  const ref = m.lvalue(e, env, false);
  if (ref.t.k !== "text" && !(typed && ref.t.k === "file"))
    compileError(26, e.line, ref.t.k === "file" ? `${name} only works with text files.` : `${name} needs a ${typed ? "file" : "text file"} variable.`);
  return ref.get();
}
// The type of a file variable (text or file of …), or null if e isn't one
function fileType(e: Expr, env: Env): T | null {
  if (e.k !== "id") return null;
  const f = env.lookup(e.name);
  if (!f) return null;
  const t = isRefObj(f) ? f.t : f.kind === "var" ? f.t : f.kind === "ref" ? f.ref.t : null;
  return t && (t.k === "text" || t.k === "file") ? t : null;
}
const isFileExpr = (m: Machine, e: Expr, env: Env) => fileType(e, env)?.k === "text";
const realFn = (name: string, f: (x: number) => number, check?: (x: number, line: number) => void): Builtin => (m, args, env, line) => {
  argc(name, args, 1, line);
  const x = num(m, args[0], env, name).v;
  check?.(x, line);
  return { t: REAL, v: f(x) };
};

function writeBuiltin(newline: boolean): Builtin {
  return (m, args, env, line) => {
    const ft = args.length > 0 ? fileType(args[0], env) : null;
    if (ft && ft.k === "file") {
      // write(f, record): store whole values at the file position
      if (newline) compileError(26, line, "writeln only works with text files. Use write(f, value).");
      const f = fileArg(m, args[0], env, "write", true);
      const recs = m.typedFile(f, line);
      for (const a of args.slice(1)) {
        const v = clone(m.convert(m.eval(a, env), ft.of, line));
        if (f.pos > recs.length) runtimeError(100, "Disk read error: the position is past the end of the file.", line);
        recs[f.pos++] = v;
        if (recs.length > 2000) runtimeError(101, "Disk write error: the file got too big.", line);
      }
      return;
    }
    let out: (s: string) => void = m.write;
    let rest = args;
    if (args.length > 0 && isFileExpr(m, args[0], env)) {
      const f = fileArg(m, args[0], env, "write");
      if (f.mode !== "write") runtimeError(f.mode === "closed" ? 103 : 105, f.mode === "closed" ? "File not open. Call rewrite(f) or append(f) first." : "File not open for output: it was opened with reset.", line);
      out = (s: string) => {
        const now = (m.files.get(f.name!) ?? "") + s;
        if (now.length > MAX_OUTPUT) runtimeError(101, "Disk write error: the file got too big.", line);
        m.files.set(f.name!, now);
      };
      rest = args.slice(1);
    }
    let text = "";
    for (const a of rest) {
      if (a.k === "fmt") {
        const v = m.eval(a.e, env);
        const w = intArg(m, a.width, env, "The width");
        const d = a.decimals ? intArg(m, a.decimals, env, "The number of decimals") : null;
        text += m.formatValue(v, w, d, a.line);
      } else text += m.formatValue(m.eval(a, env), null, null, a.line);
    }
    if (newline) text += "\n";
    out(text);
  };
}

function readBuiltin(newline: boolean): Builtin {
  return (m, args, env, line) => {
    const ft = args.length > 0 ? fileType(args[0], env) : null;
    if (ft && ft.k === "file") {
      if (newline) compileError(26, line, "readln only works with text files. Use read(f, variable).");
      const f = fileArg(m, args[0], env, "read", true);
      const recs = m.typedFile(f, line);
      for (const a of args.slice(1)) {
        const ref = m.lvalue(a, env, true);
        if (f.pos >= recs.length) runtimeError(100, "Disk read error: there is no more record to read. Check eof(f) first.", line);
        ref.set(clone(m.convert({ t: ft.of, v: recs[f.pos++] }, ref.t, line)));
      }
      return;
    }
    let rest = args;
    let file: FileVal | null = null;
    if (args.length > 0 && isFileExpr(m, args[0], env)) {
      file = fileArg(m, args[0], env, "read");
      rest = args.slice(1);
    }
    const doRead = () => {
      for (const a of rest) {
        if (!(a.k === "id" || a.k === "idx" || a.k === "field" || a.k === "deref")) compileError(20, line, "read needs variables to read into.");
        const ref = m.lvalue(a, env, true);
        if (newline && base(ref.t).k === "char" && m.peekc() === "\n") {
          ref.set(" ");
          continue;
        }
        m.readInto(ref, line, file ? `file ${file.name}` : "the input");
      }
      if (newline) m.skipLine();
    };
    if (file) m.withFile(file, line, doRead);
    else {
      // Like on a real screen, what the user types appears after the question
      const start = m.inPos;
      doRead();
      // (a line break left over from an earlier read isn't shown again)
      const typed = m.stdin.slice(start, m.inPos);
      m.write(/\S/.test(typed) ? typed.replace(/^\n+/, "") : typed);
    }
  };
}

const BUILTINS: Record<string, Builtin> = {
  abs: (m, a, env, line) => {
    argc("abs", a, 1, line);
    const v = num(m, a[0], env, "abs");
    return { t: v.t.k === "real" ? REAL : base(v.t), v: Math.abs(v.v) };
  },
  sqr: (m, a, env, line) => {
    argc("sqr", a, 1, line);
    const v = num(m, a[0], env, "sqr");
    if (v.t.k === "real") return { t: REAL, v: v.v * v.v };
    const t = intResult(base(v.t), base(v.t));
    return { t, v: wrapInt(v.v * v.v, t) };
  },
  sqrt: realFn("sqrt", Math.sqrt, (x, line) => {
    if (x < 0) runtimeError(207, "Invalid floating point operation: sqrt of a negative number.", line);
  }),
  sin: realFn("sin", Math.sin),
  cos: realFn("cos", Math.cos),
  arctan: realFn("arctan", Math.atan),
  exp: realFn("exp", Math.exp),
  ln: realFn("ln", Math.log, (x, line) => {
    if (x <= 0) runtimeError(207, "Invalid floating point operation: ln needs a number above 0.", line);
  }),
  frac: realFn("frac", (x) => x - Math.trunc(x)),
  int: realFn("int", Math.trunc),
  trunc: (m, a, env, line) => {
    argc("trunc", a, 1, line);
    return { t: LONGINT, v: Math.trunc(num(m, a[0], env, "trunc").v) };
  },
  round: (m, a, env, line) => {
    argc("round", a, 1, line);
    const x = num(m, a[0], env, "round").v;
    return { t: LONGINT, v: Math.sign(x) * Math.round(Math.abs(x)) }; // halves go away from zero
  },
  odd: (m, a, env, line) => {
    argc("odd", a, 1, line);
    return { t: BOOL, v: Math.abs(intArg(m, a[0], env, "odd")) % 2 === 1 };
  },
  ord: (m, a, env, line) => {
    argc("ord", a, 1, line);
    const v = m.eval(a[0], env);
    if (!isOrdinal(v.t)) compileError(26, line, "ord needs a char, boolean, integer or enumeration value.");
    return { t: LONGINT, v: ordOf(v.v, v.t) };
  },
  chr: (m, a, env, line) => {
    argc("chr", a, 1, line);
    return { t: CHAR, v: String.fromCharCode(intArg(m, a[0], env, "chr") & 255) };
  },
  succ: (m, a, env, line) => {
    argc("succ", a, 1, line);
    const v = m.eval(a[0], env);
    if (!isOrdinal(v.t)) compileError(26, line);
    const o = ordOf(v.v, v.t) + 1;
    const b = base(v.t);
    if (b.k === "enum" && o >= b.names.length) runtimeError(201, `Range check error: ${b.names[o - 1]} is the last value, it has no successor.`, line);
    return { t: v.t, v: fromOrd(b.k === "int" ? wrapInt(o, b) : o, v.t) };
  },
  pred: (m, a, env, line) => {
    argc("pred", a, 1, line);
    const v = m.eval(a[0], env);
    if (!isOrdinal(v.t)) compileError(26, line);
    const o = ordOf(v.v, v.t) - 1;
    const b = base(v.t);
    if (b.k === "enum" && o < 0) runtimeError(201, `Range check error: ${b.names[0]} is the first value, it has no predecessor.`, line);
    return { t: v.t, v: fromOrd(b.k === "int" ? wrapInt(o, b) : o, v.t) };
  },
  length: (m, a, env, line) => {
    argc("length", a, 1, line);
    const v = m.eval(a[0], env);
    if (v.t.k === "array") return { t: INTEGER, v: (v.v as any[]).length };
    if (!isStringy(v.t)) compileError(26, line, "length needs a string.");
    return { t: INTEGER, v: (v.v as string).length };
  },
  upcase: (m, a, env, line) => {
    argc("upcase", a, 1, line);
    const v = m.eval(a[0], env);
    if (v.t.k !== "char") compileError(26, line, "upcase works on one char. For a whole string, go through it with a loop.");
    return { t: CHAR, v: (v.v as string).toUpperCase() };
  },
  copy: (m, a, env, line) => {
    argc("copy", a, 3, line);
    const s = strArg(m, a[0], env, "copy");
    let start = intArg(m, a[1], env, "copy");
    const count = intArg(m, a[2], env, "copy");
    if (start < 1) start = 1;
    return { t: STRING, v: count <= 0 ? "" : s.substr(start - 1, count) };
  },
  pos: (m, a, env, line) => {
    argc("pos", a, 2, line);
    const sub = strArg(m, a[0], env, "pos");
    const s = strArg(m, a[1], env, "pos");
    return { t: INTEGER, v: sub === "" ? 0 : s.indexOf(sub) + 1 };
  },
  concat: (m, a, env, line) => {
    if (a.length < 1) argc("concat", a, 1, line);
    return { t: STRING, v: a.map((x) => strArg(m, x, env, "concat")).join("").slice(0, 255) };
  },
  random: (m, a, env, line) => {
    argc("random", a, [0, 1], line);
    m.seed = (m.seed * 1103515245 + 12345) & 0x7fffffff;
    const r = m.seed / 0x80000000;
    if (a.length === 0) return { t: REAL, v: r };
    const n = intArg(m, a[0], env, "random");
    return { t: INTEGER, v: n <= 0 ? 0 : Math.floor(r * n) };
  },
  high: (m, a, env, line) => {
    argc("high", a, 1, line);
    const t = m.lvalue(a[0], env, false).t;
    if (t.k === "array") return t.hi < t.lo ? { t: INTEGER, v: (m.lvalue(a[0], env, false).get() as any[]).length - 1 } : { t: t.index, v: fromOrd(t.hi, t.index) };
    if (t.k === "str") return { t: INTEGER, v: t.max };
    if (isOrdinal(t)) return { t, v: fromOrd(ordHigh(t), t) };
    compileError(26, line);
  },
  low: (m, a, env, line) => {
    argc("low", a, 1, line);
    const t = m.lvalue(a[0], env, false).t;
    if (t.k === "array") return t.hi < t.lo ? { t: INTEGER, v: 0 } : { t: t.index, v: fromOrd(t.lo, t.index) };
    if (isOrdinal(t)) return { t, v: fromOrd(ordLow(t), t) };
    compileError(26, line);
  },
  eof: (m, a, env, line) => {
    argc("eof", a, [0, 1], line);
    if (a.length === 0) return { t: BOOL, v: m.inPos >= m.stdin.length };
    const f = fileArg(m, a[0], env, "eof", true);
    if (f.typed) return { t: BOOL, v: f.pos >= m.typedFile(f, line).length };
    return { t: BOOL, v: m.withFile(f, line, () => m.inPos >= m.stdin.length) };
  },
  filesize: (m, a, env, line) => {
    argc("filesize", a, 1, line);
    const f = fileArg(m, a[0], env, "filesize", true);
    if (!f.typed) compileError(26, line, "filesize only works with typed files (file of …).");
    return { t: LONGINT, v: m.typedFile(f, line).length };
  },
  filepos: (m, a, env, line) => {
    argc("filepos", a, 1, line);
    const f = fileArg(m, a[0], env, "filepos", true);
    if (!f.typed) compileError(26, line, "filepos only works with typed files (file of …).");
    m.typedFile(f, line);
    return { t: LONGINT, v: f.pos };
  },
  wherex: (m, a, env, line) => {
    argc("wherex", a, 0, line);
    return { t: INTEGER, v: m.screen ? m.cx : 1 };
  },
  wherey: (m, a, env, line) => {
    argc("wherey", a, 0, line);
    return { t: INTEGER, v: m.screen ? m.cy : 1 };
  },
  // readkey takes the next key without showing it (here: the next character the app types)
  readkey: (m, a, env, line) => {
    argc("readkey", a, 0, line);
    while (m.inPos < m.stdin.length && m.stdin[m.inPos] === "\n") m.inPos++;
    if (m.inPos >= m.stdin.length) runtimeError(100, "No more keys: the program waits for a key, but nothing more was typed.", line);
    return { t: CHAR, v: m.stdin[m.inPos++] };
  },
  keypressed: (m, a, env, line) => {
    argc("keypressed", a, 0, line);
    return { t: BOOL, v: m.inPos < m.stdin.length };
  },
  eoln: (m, a, env, line) => {
    argc("eoln", a, [0, 1], line);
    const check = () => m.inPos >= m.stdin.length || m.stdin[m.inPos] === "\n";
    if (a.length === 0) return { t: BOOL, v: check() };
    return { t: BOOL, v: m.withFile(fileArg(m, a[0], env, "eoln"), line, check) };
  },
  // Not in Turbo Pascal 3, but handy and in every later version
  lowercase: (m, a, env, line) => {
    argc("lowercase", a, 1, line);
    const v = m.eval(a[0], env);
    if (!isStringy(v.t)) compileError(26, line);
    return { t: v.t.k === "char" ? CHAR : STRING, v: (v.v as string).toLowerCase() };
  },
  upcasestr: (m, a, env, line) => {
    argc("upcasestr", a, 1, line);
    return { t: STRING, v: strArg(m, a[0], env, "upcasestr").toUpperCase() };
  },
};

const BUILTIN_PROCS: Record<string, Builtin> = {
  write: writeBuiltin(false),
  writeln: writeBuiltin(true),
  read: readBuiltin(false),
  readln: readBuiltin(true),
  inc: (m, a, env, line) => {
    argc("inc", a, [1, 2], line);
    const ref = m.lvalue(a[0], env, true);
    if (!isOrdinal(ref.t)) compileError(26, line, "inc works on integers, chars and other ordinal values.");
    const by = a.length > 1 ? intArg(m, a[1], env, "inc") : 1;
    const o = ordOf(ref.get(), ref.t) + by;
    const b = base(ref.t);
    ref.set(fromOrd(b.k === "int" ? wrapInt(o, b) : o, ref.t));
  },
  dec: (m, a, env, line) => {
    argc("dec", a, [1, 2], line);
    const ref = m.lvalue(a[0], env, true);
    if (!isOrdinal(ref.t)) compileError(26, line, "dec works on integers, chars and other ordinal values.");
    const by = a.length > 1 ? intArg(m, a[1], env, "dec") : 1;
    const o = ordOf(ref.get(), ref.t) - by;
    const b = base(ref.t);
    ref.set(fromOrd(b.k === "int" ? wrapInt(o, b) : o, ref.t));
  },
  halt: (m, a, env, line) => {
    argc("halt", a, [0, 1], line);
    throw new HaltSignal();
  },
  exit: (m, a, env, line) => {
    argc("exit", a, 0, line);
    throw new ExitSignal();
  },
  break: (m, a, env, line) => {
    throw new BreakSignal();
  },
  continue: (m, a, env, line) => {
    throw new ContinueSignal();
  },
  randomize: () => {},
  clrscr: (m) => {
    if (m.screen) {
      m.screen.forEach((r) => r.fill(" "));
      m.cx = m.cy = 1;
    } else m.clearedAt = m.getOutput().length;
  },
  gotoxy: (m, a, env, line) => {
    argc("gotoxy", a, 2, line);
    const x = intArg(m, a[0], env, "gotoxy");
    const y = intArg(m, a[1], env, "gotoxy");
    if (!m.screen) m.startScreen(m.getOutput().slice(m.clearedAt));
    // Like Turbo Pascal, a position outside the 80 × 25 screen is ignored
    if (x >= 1 && x <= 80 && y >= 1 && y <= 25) {
      m.cx = x;
      m.cy = y;
    }
  },
  clreol: (m) => {
    if (m.screen) for (let x = m.cx; x <= 80; x++) m.screen[m.cy - 1][x - 1] = " ";
  },
  textcolor: () => {},
  textbackground: () => {},
  highvideo: () => {},
  lowvideo: () => {},
  normvideo: () => {},
  delay: () => {},
  sound: () => {},
  nosound: () => {},
  new: (m, a, env, line) => {
    argc("new", a, 1, line);
    const ref = m.lvalue(a[0], env, true);
    if (ref.t.k !== "ptr") compileError(123, line);
    const target = m.ptrTarget(ref.t, line);
    ref.set({ cell: { v: defaultValue(target) }, t: target, alive: true } as Pointer);
  },
  dispose: (m, a, env, line) => {
    argc("dispose", a, 1, line);
    const v = m.eval(a[0], env);
    if (v.t.k !== "ptr") compileError(123, line);
    const p = v.v as Pointer;
    if (p === null) runtimeError(204, "Invalid pointer operation: dispose of a NIL pointer.", line);
    if (!p.alive) runtimeError(204, "Invalid pointer operation: this memory was already disposed.", line);
    p.alive = false;
  },
  str: (m, a, env, line) => {
    argc("str", a, 2, line);
    const arg = a[0];
    const ref = m.lvalue(a[1], env, true);
    if (!isStringy(ref.t) || ref.t.k === "char") compileError(26, line, "str(x, s) needs a string variable for s.");
    let text: string;
    if (arg.k === "fmt") {
      const v = m.eval(arg.e, env);
      text = m.formatValue(v, intArg(m, arg.width, env, "width"), arg.decimals ? intArg(m, arg.decimals, env, "decimals") : null, line);
    } else {
      const v = m.eval(arg, env);
      if (!isNumeric(v.t)) compileError(26, line, "str turns a number into text.");
      text = m.formatValue(v, null, null, line);
    }
    ref.set(m.convert({ t: STRING, v: text }, ref.t, line));
  },
  val: (m, a, env, line) => {
    argc("val", a, 3, line);
    const s = strArg(m, a[0], env, "val");
    const target = m.lvalue(a[1], env, true);
    const code = m.lvalue(a[2], env, true);
    const isI = isInt(target.t);
    const re = isI ? /^\s*[+-]?\d+$/ : /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
    if (re.test(s)) {
      target.set(m.convert({ t: isI ? LONGINT : REAL, v: Number(s) }, target.t, line));
      code.set(0);
    } else {
      // the position of the first bad character, like Turbo Pascal
      let p = 1;
      while (p <= s.length && re.test(s.slice(0, p))) p++;
      code.set(s.length === 0 ? 1 : p);
    }
  },
  delete: (m, a, env, line) => {
    argc("delete", a, 3, line);
    const ref = m.lvalue(a[0], env, true);
    if (ref.t.k !== "str") compileError(26, line, "delete needs a string variable.");
    const start = intArg(m, a[1], env, "delete");
    const count = intArg(m, a[2], env, "delete");
    const s = ref.get() as string;
    if (start < 1 || start > s.length || count <= 0) return;
    ref.set(s.slice(0, start - 1) + s.slice(start - 1 + count));
  },
  insert: (m, a, env, line) => {
    argc("insert", a, 3, line);
    const piece = strArg(m, a[0], env, "insert");
    const ref = m.lvalue(a[1], env, true);
    if (ref.t.k !== "str") compileError(26, line, "insert needs a string variable.");
    let at = intArg(m, a[2], env, "insert");
    const s = ref.get() as string;
    if (at < 1) at = 1;
    if (at > s.length + 1) at = s.length + 1;
    ref.set(m.convert({ t: STRING, v: s.slice(0, at - 1) + piece + s.slice(at - 1) }, ref.t, line));
  },
  include: (m, a, env, line) => {
    argc("include", a, 2, line);
    const ref = m.lvalue(a[0], env, true);
    if (ref.t.k !== "set") compileError(26, line);
    const v = m.eval(a[1], env);
    (ref.get() as Set<number>).add(ordOf(v.v, v.t));
  },
  exclude: (m, a, env, line) => {
    argc("exclude", a, 2, line);
    const ref = m.lvalue(a[0], env, true);
    if (ref.t.k !== "set") compileError(26, line);
    const v = m.eval(a[1], env);
    (ref.get() as Set<number>).delete(ordOf(v.v, v.t));
  },
  // ----- text files on the little disk -----
  assign: (m, a, env, line) => {
    argc("assign", a, 2, line);
    const f = fileArg(m, a[0], env, "assign", true);
    f.name = strArg(m, a[1], env, "assign").toUpperCase();
    f.mode = "closed";
  },
  reset: (m, a, env, line) => {
    argc("reset", a, 1, line);
    const f = fileArg(m, a[0], env, "reset", true);
    if (!f.name) runtimeError(102, "File not assigned. Call assign(f, 'NAME.TXT') first.", line);
    if (f.typed) {
      // reset opens a typed file for reading and writing, at the first record
      if (!m.records.has(f.name)) runtimeError(2, `File not found: there is no ${f.name} on the disk.`, line);
      f.mode = "read";
      f.pos = 0;
      return;
    }
    if (!m.files.has(f.name)) runtimeError(2, `File not found: there is no ${f.name} on the disk.`, line);
    f.mode = "read";
    f.pos = 0;
  },
  rewrite: (m, a, env, line) => {
    argc("rewrite", a, 1, line);
    const f = fileArg(m, a[0], env, "rewrite", true);
    if (!f.name) runtimeError(102, "File not assigned. Call assign(f, 'NAME.TXT') first.", line);
    if (f.typed) {
      m.records.set(f.name, []);
      f.mode = "write";
      f.pos = 0;
      return;
    }
    m.files.set(f.name, "");
    f.mode = "write";
  },
  append: (m, a, env, line) => {
    argc("append", a, 1, line);
    const f = fileArg(m, a[0], env, "append");
    if (!f.name) runtimeError(102, "File not assigned. Call assign(f, 'NAME.TXT') first.", line);
    if (!m.files.has(f.name)) runtimeError(2, `File not found: there is no ${f.name} to append to.`, line);
    f.mode = "write";
  },
  close: (m, a, env, line) => {
    argc("close", a, 1, line);
    const f = fileArg(m, a[0], env, "close", true);
    if (f.mode === "closed") runtimeError(103, "File not open.", line);
    f.mode = "closed";
  },
  erase: (m, a, env, line) => {
    argc("erase", a, 1, line);
    const f = fileArg(m, a[0], env, "erase", true);
    const disk: Map<string, unknown> = f.typed ? m.records : m.files;
    if (!f.name || !disk.has(f.name)) runtimeError(2, "File not found.", line);
    disk.delete(f.name);
  },
  // ----- typed files: jump to a record -----
  seek: (m, a, env, line) => {
    argc("seek", a, 2, line);
    const f = fileArg(m, a[0], env, "seek", true);
    if (!f.typed) compileError(26, line, "seek only works with typed files (file of …).");
    const n = intArg(m, a[1], env, "seek");
    const recs = m.typedFile(f, line);
    if (n < 0 || n > recs.length) runtimeError(100, `Disk read error: record ${n} doesn't exist. The file has ${recs.length} records, numbered from 0.`, line);
    f.pos = n;
  },
};

// ---------- Running a program ----------

export function runPascal(source: string, inputs: (number | string)[] = []): RunResult {
  let output = "";
  let m: Machine | null = null;
  let written = 0;
  const write = (s: string) => {
    written += s.length;
    if (written > MAX_OUTPUT) throw new RuntimeError("Output limit exceeded: the program printed too much. Check your loops.");
    if (m?.screen) m.screenWrite(s);
    else output += s;
  };
  const shown = () => (m?.screen ? m.screenText() : output);
  try {
    const block = new Parser(tokenize(source)).program();
    m = new Machine(write, inputs.map(String).join("\n") + (inputs.length ? "\n" : ""));
    m.getOutput = () => output;
    const global = new Env(null);
    global.globalScope = true;
    // Units: each one gets its own place for its names; the program sees only the interface
    const exports = new Map<string, Map<string, Entry>>();
    const useUnits = (uses: { name: string; line: number }[], into: Env) => {
      for (const u of uses) {
        const ex = exports.get(u.name);
        if (ex) for (const [k, v] of ex) into.map.set(k, v);
        else if (!SYSTEM_UNITS.has(u.name)) compileError(15, u.line, `${u.name.toUpperCase()}.TPU: there is no unit with that name. Write the unit above the program.`);
      }
    };
    const inits: { stmts: Stmt[]; env: Env }[] = [];
    for (const u of block.units ?? []) {
      if (exports.has(u.name)) compileError(4, u.line, `There are two units called ${u.name}.`);
      const uenv = new Env(null);
      uenv.globalScope = true;
      useUnits(u.uses, uenv);
      const before = new Set(uenv.map.keys());
      m.declare({ decls: u.iface }, uenv, false);
      const iface = [...uenv.map.keys()].filter((k) => !before.has(k));
      m.declare({ decls: u.impl }, uenv, true);
      exports.set(u.name, new Map(iface.map((k) => [k, uenv.map.get(k)!])));
      inits.push({ stmts: u.init, env: uenv });
    }
    useUnits(block.uses ?? [], global);
    m.crt = [...(block.uses ?? []), ...(block.units ?? []).flatMap((u) => u.uses)].some((u) => u.name === "crt");
    try {
      for (const init of inits) for (const s of init.stmts) m.exec(s, init.env);
      m.declare(block, global);
      for (const s of block.body) m.exec(s, global);
    } catch (e) {
      if (!(e instanceof HaltSignal) && !(e instanceof ExitSignal)) throw e;
    }
    return { output: shown(), error: null };
  } catch (e) {
    // Compile errors stop the program before it runs, so nothing was printed
    if (e instanceof CompileError) return { output: "", error: e.message };
    if (e instanceof RuntimeError) return { output: shown(), error: e.message };
    if (e instanceof BreakSignal || e instanceof ContinueSignal) return { output: "", error: "Error 5: BREAK and CONTINUE only work inside a loop." };
    if (e instanceof RangeError) return { output: shown(), error: "Runtime error 202: Stack overflow. Does a routine call itself forever?" };
    return { output: shown(), error: "Something went wrong running the program." };
  }
}
