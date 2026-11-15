// A small C interpreter, like running `cc lesson.c && ./a.out` on a PDP-11 with Unix.
// Supports what the course teaches:
//   int, char, double (float, long, short, unsigned are accepted as their nearest type), void,
//   pointers, arrays (also 2D), strings, structs, unions, enums, typedef, function pointers,
//   #define constants and macros, #ifdef / #ifndef
//   if/else, while, do/while, for, switch, break, continue, return, functions and recursion
//   printf, scanf, putchar, getchar, puts, strlen, strcpy, strcmp, strcat, abs, sqrt, pow, sin, cos, fabs, rand
// Errors look like the compiler's ("lesson.c:3: error: …") or like Unix at run time ("Segmentation fault").

import type { RunResult } from "./course";

const MAX_STEPS = 2_000_000;
const MAX_DEPTH = 800;
const MAX_OUTPUT = 20000;

// ---------- Types ----------

type StructDef = { name: string; fields: { name: string; type: CType; offset: number }[]; cells: number; union?: boolean };
type CType =
  | { k: "int" }
  | { k: "char" }
  | { k: "double" }
  | { k: "void" }
  | { k: "ptr"; of: CType }
  | { k: "array"; of: CType; len: number }
  | { k: "struct"; def: StructDef }
  | { k: "fn"; ret: CType; params: CType[] }; // a function, only ever used through a pointer

const INT: CType = { k: "int" };
const CHAR: CType = { k: "char" };
const DOUBLE: CType = { k: "double" };
const VOID: CType = { k: "void" };
const ptr = (of: CType): CType => ({ k: "ptr", of });

// Memory is a list of cells: one cell per int, char, double or pointer.
function cells(t: CType): number {
  if (t.k === "array") return t.len * cells(t.of);
  if (t.k === "struct") return t.def.cells;
  return 1;
}

// sizeof in bytes, like a modern 64-bit Unix (on the real PDP-11, an int had 2 bytes)
function bytes(t: CType): number {
  switch (t.k) {
    case "char":
      return 1;
    case "int":
      return 4;
    case "double":
      return 8;
    case "ptr":
      return 8;
    case "void":
      return 1;
    case "array":
      return t.len * bytes(t.of);
    case "struct":
      return t.def.union ? Math.max(0, ...t.def.fields.map((f) => bytes(f.type))) : t.def.fields.reduce((s, f) => s + bytes(f.type), 0);
    case "fn":
      return 1;
  }
}

function typeName(t: CType): string {
  switch (t.k) {
    case "ptr":
      if (t.of.k === "fn") return `${typeName(t.of.ret)} (*)(${t.of.params.map(typeName).join(", ")})`;
      return typeName(t.of) + " *";
    case "fn":
      return `${typeName(t.ret)} (${t.params.map(typeName).join(", ")})`;
    case "array":
      return `${typeName(t.of)}[${t.len}]`;
    case "struct":
      return t.def === FILE_DEF ? "FILE" : `${t.def.union ? "union" : "struct"} ${t.def.name}`;
    default:
      return t.k;
  }
}

const isArith = (t: CType) => t.k === "int" || t.k === "char" || t.k === "double";
const isIntegral = (t: CType) => t.k === "int" || t.k === "char";

// ---------- Errors ----------

class CompileError extends Error {}
class RuntimeError extends Error {}
class ExitSignal extends Error {
  constructor(public code: number) {
    super("exit");
  }
}
class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  constructor(public value: Value | null) {}
}

function compileError(line: number, msg: string): never {
  throw new CompileError(`lesson.c:${line}: error: ${msg}`);
}

// ---------- Tokens ----------

type Tok = { t: "id" | "num" | "str" | "chr" | "op" | "eof"; v: string; n?: number; isFloat?: boolean; line: number };

const OPS = [
  "<<=", ">>=", "...", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "+", "-", "*", "/", "%", "<", ">", "=", "!", "~", "&", "|", "^", "?", ":", ";", ",", ".", "(", ")", "[", "]", "{", "}",
];

function unescape(s: string, line: number): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") {
      out += s[i];
      continue;
    }
    const c = s[++i];
    if (c === "n") out += "\n";
    else if (c === "t") out += "\t";
    else if (c === "0") out += "\0";
    else if (c === "\\") out += "\\";
    else if (c === "'") out += "'";
    else if (c === '"') out += '"';
    else if (c === "r") out += "\r";
    else if (c === "a") out += "\x07";
    else compileError(line, `unknown escape sequence '\\${c}'`);
  }
  return out;
}

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
    // Comments
    if (src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) compileError(line, "unterminated comment");
      for (let j = i; j < end; j++) if (src[j] === "\n") line++;
      i = end + 2;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /\w/.test(src[j])) j++;
      toks.push({ t: "id", v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      let j = i;
      if (src.startsWith("0x", i) || src.startsWith("0X", i)) {
        j += 2;
        while (/[0-9a-fA-F]/.test(src[j] ?? "")) j++;
        toks.push({ t: "num", v: src.slice(i, j), n: parseInt(src.slice(i + 2, j), 16), line });
      } else {
        while (/[\d.]/.test(src[j] ?? "")) j++;
        if (/[eE]/.test(src[j] ?? "") && /[\d+-]/.test(src[j + 1] ?? "")) {
          j += 2;
          while (/\d/.test(src[j] ?? "")) j++;
        }
        const text = src.slice(i, j);
        const isFloat = /[.eE]/.test(text);
        const n = isFloat ? parseFloat(text) : text.length > 1 && text.startsWith("0") ? parseInt(text, 8) : parseInt(text, 10);
        if (Number.isNaN(n)) compileError(line, `invalid number '${text}'`);
        toks.push({ t: "num", v: text, n, isFloat, line });
      }
      while (/[uUlLfF]/.test(src[j] ?? "")) j++; // 10L, 2.5f
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++;
        if (src[j] === "\n") compileError(line, `missing terminating ${c} character`);
        j++;
      }
      if (j >= src.length) compileError(line, `missing terminating ${c} character`);
      const text = unescape(src.slice(i + 1, j), line);
      if (c === "'") {
        if (text.length !== 1) compileError(line, "a character constant holds exactly one character, like 'A'");
        toks.push({ t: "chr", v: text, n: text.charCodeAt(0), line });
      } else toks.push({ t: "str", v: text, line });
      i = j + 1;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) compileError(line, `stray '${c}' in program`);
    toks.push({ t: "op", v: op, line });
    i += op.length;
  }
  toks.push({ t: "eof", v: "end of file", line });
  return toks;
}

// The preprocessor: #include is accepted, #define NAME value replaces words,
// #define NAME(a, b) … is a macro with arguments, and #ifdef / #ifndef / #if 0 / #else / #endif
// switch lines on and off
type Macro = { params: string[] | null; body: string };

// Replace macros in one line of code, outside of strings and character constants
function expandMacros(text: string, macros: Map<string, Macro>, line: number, depth = 0): string {
  if (depth > 20) throw new CompileError(`lesson.c:${line}: error: a macro keeps expanding into itself`);
  let out = "";
  let changed = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (text.startsWith("//", i)) {
      out += text.slice(i);
      break;
    }
    if (/[A-Za-z_]/.test(c) && !/\w/.test(text[i - 1] ?? "")) {
      let j = i;
      while (j < text.length && /\w/.test(text[j])) j++;
      const word = text.slice(i, j);
      const m = macros.get(word);
      if (!m) {
        out += word;
        i = j;
        continue;
      }
      if (m.params === null) {
        out += m.body;
        changed = true;
        i = j;
        continue;
      }
      // A macro with arguments: only when ( follows
      let k = j;
      while (text[k] === " " || text[k] === "\t") k++;
      if (text[k] !== "(") {
        out += word;
        i = j;
        continue;
      }
      const args: string[] = [];
      let level = 0;
      let cur = "";
      k++;
      for (; k < text.length; k++) {
        const ch = text[k];
        if (ch === '"' || ch === "'") {
          let e = k + 1;
          while (e < text.length && text[e] !== ch) e += text[e] === "\\" ? 2 : 1;
          cur += text.slice(k, e + 1);
          k = e;
          continue;
        }
        if (ch === "(") level++;
        if (ch === ")") {
          if (level === 0) break;
          level--;
        }
        if (ch === "," && level === 0) {
          args.push(cur.trim());
          cur = "";
          continue;
        }
        cur += ch;
      }
      if (k >= text.length) throw new CompileError(`lesson.c:${line}: error: unterminated argument list invoking macro "${word}"`);
      if (cur.trim() !== "" || args.length > 0) args.push(cur.trim());
      if (args.length !== m.params.length)
        throw new CompileError(`lesson.c:${line}: error: macro "${word}" needs ${m.params.length} argument${m.params.length === 1 ? "" : "s"}, but got ${args.length}`);
      // Put the arguments in, word for word: the text is pasted, not calculated
      out += m.body.replace(/\b[A-Za-z_]\w*\b/g, (w) => {
        const at = m.params!.indexOf(w);
        return at < 0 ? w : args[at];
      });
      changed = true;
      i = k + 1;
      continue;
    }
    out += c;
    i++;
  }
  return changed ? expandMacros(out, macros, line, depth + 1) : out;
}

function preprocess(src: string): string {
  // From <stdio.h> and <stdlib.h>
  const macros = new Map<string, Macro>(
    (
      [
        ["EOF", "(-1)"],
        ["NULL", "0"],
        ["RAND_MAX", "32767"],
        ["size_t", "unsigned long"],
        ["stdin", "__stdio(0)"],
        ["stdout", "__stdio(1)"],
        ["stderr", "__stdio(2)"],
      ] as [string, string][]
    ).map(([k, v]) => [k, { params: null, body: v }])
  );
  const lines = src.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  // #ifdef nesting: is each level switched on, and has it had its #else?
  const conds: { on: boolean; parentOn: boolean; sawElse: boolean }[] = [];
  const active = () => conds.every((c) => c.on);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    const n = idx + 1;
    if (line.startsWith("#")) {
      const directive = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").trim();
      let m: RegExpMatchArray | null;
      if ((m = directive.match(/^#\s*(ifdef|ifndef)\s+([A-Za-z_]\w*)$/))) {
        const has = macros.has(m[2]);
        conds.push({ on: m[1] === "ifdef" ? has : !has, parentOn: active(), sawElse: false });
      } else if ((m = directive.match(/^#\s*if\s+(.+)$/))) {
        const e = m[1].trim();
        let v: boolean;
        if (/^\d+$/.test(e)) v = e !== "0";
        else if ((m = e.match(/^(!)?\s*defined\s*\(?\s*([A-Za-z_]\w*)\s*\)?$/))) v = macros.has(m[2]) !== !!m[1];
        else if (/^[A-Za-z_]\w*$/.test(e)) v = macros.has(e) && macros.get(e)!.body.trim() !== "0";
        else throw new CompileError(`lesson.c:${n}: error: this #if is too complicated here. Use #if 0, #if 1, #ifdef or #ifndef`);
        conds.push({ on: v, parentOn: active(), sawElse: false });
      } else if (/^#\s*else$/.test(directive)) {
        const c = conds[conds.length - 1];
        if (!c) throw new CompileError(`lesson.c:${n}: error: #else without #if`);
        if (c.sawElse) throw new CompileError(`lesson.c:${n}: error: #else after #else`);
        c.on = !c.on;
        c.sawElse = true;
      } else if (/^#\s*endif$/.test(directive)) {
        if (!conds.pop()) throw new CompileError(`lesson.c:${n}: error: #endif without #if`);
      } else if (!active()) {
        // switched off: skip everything else
      } else if (/^#\s*include\s*[<"][\w./]+[>"]$/.test(directive)) {
        // nothing to do: printf and friends are always there
      } else if ((m = directive.match(/^#\s*define\s+([A-Za-z_]\w*)\(([^)]*)\)\s*(.*)$/))) {
        const params = m[2].split(",").map((p) => p.trim()).filter(Boolean);
        if (params.some((p) => !/^[A-Za-z_]\w*$/.test(p))) throw new CompileError(`lesson.c:${n}: error: macro parameters must be names`);
        macros.set(m[1], { params, body: m[3] });
      } else if ((m = directive.match(/^#\s*define\s+([A-Za-z_]\w*)(?:\s+(.*))?$/))) {
        macros.set(m[1], { params: null, body: (m[2] ?? "").trim() });
      } else if ((m = directive.match(/^#\s*undef\s+([A-Za-z_]\w*)$/))) {
        macros.delete(m[1]);
      } else {
        throw new CompileError(`lesson.c:${n}: error: invalid preprocessing directive ${line.split(/\s/)[0]}`);
      }
      out.push("");
      return;
    }
    out.push(active() ? expandMacros(raw, macros, n) : "");
  });
  if (conds.length) throw new CompileError(`lesson.c:${lines.length}: error: unterminated #if: an #endif is missing`);
  return out.join("\n");
}

// ---------- AST ----------

type Expr =
  | { k: "num"; v: number; t: CType; line: number }
  | { k: "str"; s: string; line: number }
  | { k: "id"; name: string; line: number }
  | { k: "call"; name: string; args: Expr[]; line: number; callee?: Expr }
  | { k: "idx"; a: Expr; i: Expr; line: number }
  | { k: "mem"; o: Expr; name: string; arrow: boolean; line: number }
  | { k: "un"; op: string; e: Expr; line: number }
  | { k: "pre"; op: string; e: Expr; line: number }
  | { k: "post"; op: string; e: Expr; line: number }
  | { k: "bin"; op: string; l: Expr; r: Expr; line: number }
  | { k: "asg"; op: string; l: Expr; r: Expr; line: number }
  | { k: "cond"; c: Expr; a: Expr; b: Expr; line: number }
  | { k: "cast"; t: CType; e: Expr; line: number }
  | { k: "sizeof"; t?: CType; e?: Expr; line: number }
  | { k: "comma"; l: Expr; r: Expr; line: number };

type Init = { k: "expr"; e: Expr } | { k: "list"; items: Init[] };
type Decl = { name: string; type: CType; init?: Init; line: number };

type Stmt =
  | { k: "block"; body: Stmt[]; line: number }
  | { k: "decl"; decls: Decl[]; line: number }
  | { k: "expr"; e: Expr; line: number }
  | { k: "if"; c: Expr; a: Stmt; b?: Stmt; line: number }
  | { k: "while"; c: Expr; body: Stmt; line: number }
  | { k: "do"; c: Expr; body: Stmt; line: number }
  | { k: "for"; init?: Stmt; c?: Expr; step?: Expr; body: Stmt; line: number }
  | { k: "switch"; e: Expr; body: Stmt[]; cases: { value: number | null; at: number }[]; line: number }
  | { k: "break"; line: number }
  | { k: "continue"; line: number }
  | { k: "return"; e?: Expr; line: number }
  | { k: "empty"; line: number };

type Func = { name: string; ret: CType; params: { name: string; type: CType }[]; body: Stmt | null; line: number };

// ---------- Parser ----------

const TYPE_WORDS = new Set(["int", "char", "double", "float", "long", "short", "unsigned", "signed", "void", "const", "struct", "union", "enum", "static", "register", "extern", "volatile", "FILE"]);
// FILE from stdio.h: programs only ever hold a FILE *, so it needs no fields
const FILE_DEF: StructDef = { name: "FILE", fields: [], cells: 1 };
const FILE_PTR: CType = { k: "ptr", of: { k: "struct", def: FILE_DEF } };

class Parser {
  i = 0;
  structs = new Map<string, StructDef>();
  typedefs = new Map<string, CType>();
  enumConsts = new Map<string, number>();
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
  expect(v: string, what?: string) {
    if (this.eat(v)) return;
    const t = this.peek();
    // A missing ; belongs to the line before, like the real compiler says
    if (v === ";" && this.i > 0) compileError(this.toks[this.i - 1].line, `expected ';'${what ? " " + what : ""}`);
    const shown = t.t === "eof" ? "end of input" : `'${t.v}'`;
    compileError(t.t === "eof" ? this.toks[Math.max(0, this.i - 1)].line : t.line, `expected '${v}'${what ? " " + what : ""} before ${shown}`);
  }
  ident(): string {
    const t = this.next();
    if (t.t !== "id") compileError(t.line, `expected a name before '${t.v}'`);
    return t.v;
  }

  startsType(o = 0) {
    const t = this.peek(o);
    return t.t === "id" && (TYPE_WORDS.has(t.v) || this.typedefs.has(t.v));
  }

  // typedef int Number;  typedef struct node Node;  typedef int (*Op)(int, int);
  typedefDecl() {
    const base = this.baseType();
    do {
      const d = this.declarator(base);
      if (TYPE_WORDS.has(d.name)) compileError(d.line, `'${d.name}' is already a type word`);
      this.typedefs.set(d.name, d.type);
    } while (this.eat(","));
    this.expect(";", "after the typedef");
  }

  // int, unsigned long, struct point …
  baseType(): CType {
    let base: CType | null = null;
    let sawWord = false;
    while (this.startsType()) {
      const w = this.peek().v;
      const named = this.typedefs.get(w);
      if (named && !TYPE_WORDS.has(w)) {
        if (base) break; // int Node: Node is the variable's name here
        this.next();
        sawWord = true;
        base = named;
        break;
      }
      this.next();
      sawWord = true;
      if (w === "const" || w === "static" || w === "register" || w === "signed" || w === "extern" || w === "volatile") continue;
      if (w === "unsigned" || w === "long" || w === "short") {
        if (!base) base = INT;
        if (w === "long" && base.k === "double") base = DOUBLE;
        continue;
      }
      if (w === "int") base = INT;
      else if (w === "char") base = CHAR;
      else if (w === "double" || w === "float") base = DOUBLE;
      else if (w === "void") base = VOID;
      else if (w === "struct") base = this.structType(false);
      else if (w === "union") base = this.structType(true);
      else if (w === "enum") base = this.enumType();
      else if (w === "FILE") base = { k: "struct", def: FILE_DEF };
    }
    if (!sawWord || !base) compileError(this.peek().line, "expected a type like int");
    return base;
  }

  structType(union: boolean): CType {
    const word = union ? "union" : "struct";
    const line = this.peek().line;
    const name = this.peek().t === "id" ? this.next().v : `(anonymous ${line})`;
    const key = `${word} ${name}`;
    if (this.eat("{")) {
      if (this.structs.has(key)) compileError(line, `redefinition of '${key}'`);
      const def: StructDef = { name, fields: [], cells: 0, union };
      this.structs.set(key, def);
      while (!this.is("}")) {
        const base = this.baseType();
        do {
          const d = this.declarator(base);
          if (d.type.k === "struct" && d.type.def === def) compileError(d.line, `field '${d.name}' has incomplete type`);
          if (def.fields.some((f) => f.name === d.name)) compileError(d.line, `duplicate member '${d.name}'`);
          // In a union every member starts at the same place: they share the memory
          def.fields.push({ name: d.name, type: d.type, offset: union ? 0 : def.cells });
          def.cells = union ? Math.max(def.cells, cells(d.type)) : def.cells + cells(d.type);
        } while (this.eat(","));
        this.expect(";", `after a ${word} field`);
      }
      this.afterBrace(word);
      return { k: "struct", def };
    }
    const def = this.structs.get(key);
    if (!def) compileError(line, `'${key}' isn't defined yet`);
    return { k: "struct", def };
  }

  // After the } of a struct, union or enum comes a ; or a variable name
  afterBrace(word: string) {
    const close = this.next().line;
    const after = this.peek();
    if (after.t !== "eof" && after.v !== ";" && after.v !== "*" && after.t !== "id") compileError(close, `expected ';' after ${word} definition`);
    if (after.t === "id" && this.startsType()) compileError(close, `expected ';' after ${word} definition`);
  }

  // enum color { RED, GREEN, BLUE }: names for 0, 1, 2. An enum variable is an int.
  enumType(): CType {
    const line = this.peek().line;
    if (this.peek().t === "id") this.next();
    if (this.eat("{")) {
      let next = 0;
      while (!this.is("}")) {
        const t = this.next();
        if (t.t !== "id") compileError(t.line, `expected a name in the enum before '${t.v}'`);
        if (this.enumConsts.has(t.v)) compileError(t.line, `redeclaration of enumerator '${t.v}'`);
        if (this.eat("=")) {
          const v = constValue(this.cond());
          if (v === null) compileError(t.line, `enumerator value for '${t.v}' is not a constant`);
          next = Math.trunc(v);
        }
        this.enumConsts.set(t.v, next++);
        if (!this.eat(",")) break;
      }
      if (!this.is("}")) compileError(this.peek().line, "expected '}' at the end of the enum");
      this.afterBrace("enum");
    } else if (this.toks[this.i - 1].v === "enum") compileError(line, "expected a name or '{' after enum");
    return INT;
  }

  // The parameter types of a function pointer: (int, int) or (const void *a, const void *b)
  paramTypes(): CType[] {
    const types: CType[] = [];
    if (this.eat(")")) return types;
    if (this.is("void") && this.is(")", 1)) {
      this.next();
      this.next();
      return types;
    }
    do {
      let pt = this.baseType();
      while (this.eat("*")) {
        pt = ptr(pt);
        while (this.eat("const"));
      }
      if (this.peek().t === "id") this.next();
      types.push(pt.k === "array" ? ptr(pt.of) : pt);
    } while (this.eat(","));
    this.expect(")", "after the parameter types");
    return types;
  }

  // *name[3][4]
  declarator(base: CType): { name: string; type: CType; line: number } {
    let t = base;
    while (this.eat("*")) {
      t = ptr(t);
      while (this.eat("const"));
    }
    const line = this.peek().line;
    // int (*op)(int, int) is a pointer to a function, int (*ops[4])(int, int) an array of them
    if (this.is("(") && this.is("*", 1)) {
      this.next();
      let stars = 0;
      while (this.eat("*")) stars++;
      const inner = this.declarator(VOID); // just the name and any [size]
      this.expect(")", "after the function pointer's name");
      this.expect("(", "for the function pointer's parameters");
      const fnType: CType = { k: "fn", ret: t, params: this.paramTypes() };
      let full: CType = fnType;
      for (let k = 0; k < stars; k++) full = ptr(full);
      // put the pointer type where VOID was, inside any array
      const wrap = (x: CType): CType => (x.k === "array" ? { ...x, of: wrap(x.of) } : full);
      return { name: inner.name, type: wrap(inner.type), line };
    }
    const name = this.ident();
    const dims: (number | null)[] = [];
    while (this.eat("[")) {
      if (this.eat("]")) {
        dims.push(null);
        continue;
      }
      const e = this.expr();
      const n = constValue(e);
      if (n === null || n < 1) compileError(line, `size of array '${name}' must be a positive constant`);
      dims.push(Math.trunc(n));
      this.expect("]");
    }
    for (let d = dims.length - 1; d >= 0; d--) t = { k: "array", of: t, len: dims[d] ?? -1 };
    return { name, type: t, line };
  }

  program(): { funcs: Map<string, Func>; globals: Decl[]; structs: Map<string, StructDef> } {
    const funcs = new Map<string, Func>();
    const globals: Decl[] = [];
    while (this.peek().t !== "eof") {
      if (this.eat(";")) continue;
      const line = this.peek().line;
      if (this.eat("typedef")) {
        this.typedefDecl();
        continue;
      }
      if (!this.startsType()) {
        const t = this.peek();
        if (t.t === "id" && this.is("(", 1)) compileError(line, `'${t.v}' needs a return type, like int ${t.v}(…)`);
        compileError(line, `expected a declaration or a function before '${t.v}'`);
      }
      const base = this.baseType();
      if (this.eat(";")) continue; // struct definition on its own
      const first = this.declarator(base);
      if (this.eat("(")) {
        const params: { name: string; type: CType }[] = [];
        if (!this.eat(")")) {
          if (this.is("void") && this.is(")", 1)) {
            this.next();
            this.next();
          } else {
            do {
              const pt = this.baseType();
              let d: { name: string; type: CType };
              // int f(int *, char) has parameters without names
              const save = this.i;
              let ut = pt;
              while (this.eat("*")) {
                ut = ptr(ut);
                while (this.eat("const"));
              }
              if (this.is(",") || this.is(")")) d = { name: `(unnamed ${params.length})`, type: ut };
              else {
                this.i = save;
                d = this.declarator(pt);
              }
              // arrays as parameters are pointers
              const type = d.type.k === "array" ? ptr(d.type.of) : d.type;
              params.push({ name: d.name, type });
            } while (this.eat(","));
            this.expect(")");
          }
        }
        if (this.eat(";")) {
          if (!funcs.has(first.name)) funcs.set(first.name, { name: first.name, ret: first.type, params, body: null, line });
          continue;
        }
        if (!this.is("{")) compileError(this.peek().line, `expected '{' to start the body of ${first.name}()`);
        const old = funcs.get(first.name);
        if (old?.body) compileError(line, `redefinition of '${first.name}'`);
        const fn: Func = { name: first.name, ret: first.type, params, body: null, line };
        funcs.set(first.name, fn);
        fn.body = this.block();
        continue;
      }
      // global variables
      const list = [first];
      const decls: Decl[] = [];
      for (;;) {
        const d = list[list.length - 1];
        const decl: Decl = { ...d };
        if (this.eat("=")) decl.init = this.initializer();
        fixArrayLength(decl);
        decls.push(decl);
        if (!this.eat(",")) break;
        list.push(this.declarator(base));
      }
      this.expect(";", "after the declaration");
      globals.push(...decls);
    }
    return { funcs, globals, structs: this.structs };
  }

  initializer(): Init {
    if (this.eat("{")) {
      const items: Init[] = [];
      while (!this.eat("}")) {
        items.push(this.initializer());
        if (!this.eat(",")) {
          this.expect("}", "at the end of the list");
          break;
        }
      }
      return { k: "list", items };
    }
    return { k: "expr", e: this.assign() };
  }

  block(): Stmt {
    const line = this.peek().line;
    this.expect("{");
    const body: Stmt[] = [];
    while (!this.eat("}")) {
      if (this.peek().t === "eof") compileError(this.peek().line, "expected '}' at end of input");
      body.push(this.statement());
    }
    return { k: "block", body, line };
  }

  statement(): Stmt {
    const t = this.peek();
    const line = t.line;
    if (this.is("{")) return this.block();
    if (this.eat(";")) return { k: "empty", line };
    if (this.eat("typedef")) {
      this.typedefDecl();
      return { k: "empty", line };
    }
    // a variable with the same name as a typedef: x = …
    if (this.startsType() && !(this.typedefs.has(t.v) && this.peek(1).t === "op" && !["*", "("].includes(this.peek(1).v))) {
      const base = this.baseType();
      if (this.eat(";")) return { k: "empty", line };
      const decls: Decl[] = [];
      do {
        const d = this.declarator(base);
        const decl: Decl = { ...d };
        if (d.type.k === "void") compileError(d.line, `variable '${d.name}' declared void`);
        if (this.eat("=")) decl.init = this.initializer();
        fixArrayLength(decl);
        decls.push(decl);
      } while (this.eat(","));
      this.expect(";", "after the declaration");
      return { k: "decl", decls, line };
    }
    if (t.t === "id") {
      switch (t.v) {
        case "if": {
          this.next();
          this.expect("(", "after if");
          const c = this.expr();
          this.expect(")", "after the condition");
          const a = this.statement();
          const b = this.eat("else") ? this.statement() : undefined;
          return { k: "if", c, a, b, line };
        }
        case "while": {
          this.next();
          this.expect("(", "after while");
          const c = this.expr();
          this.expect(")", "after the condition");
          return { k: "while", c, body: this.statement(), line };
        }
        case "do": {
          this.next();
          const body = this.statement();
          if (!this.eat("while")) compileError(this.peek().line, "expected 'while' after the do body");
          this.expect("(");
          const c = this.expr();
          this.expect(")");
          this.expect(";", "after do … while");
          return { k: "do", c, body, line };
        }
        case "for": {
          this.next();
          this.expect("(", "after for");
          let init: Stmt | undefined;
          if (!this.eat(";")) {
            if (this.startsType()) init = this.statement();
            else {
              init = { k: "expr", e: this.expr(), line };
              this.expect(";", "in the for loop");
            }
          }
          const c = this.is(";") ? undefined : this.expr();
          this.expect(";", "in the for loop");
          const step = this.is(")") ? undefined : this.expr();
          this.expect(")", "after the for header");
          return { k: "for", init, c, step, body: this.statement(), line };
        }
        case "switch": {
          this.next();
          this.expect("(");
          const e = this.expr();
          this.expect(")");
          this.expect("{", "to start the switch body");
          const body: Stmt[] = [];
          const cases: { value: number | null; at: number }[] = [];
          while (!this.eat("}")) {
            if (this.eat("case")) {
              const ce = this.cond();
              const v = constValue(ce);
              if (v === null) compileError(line, "case label must be a constant");
              this.expect(":", "after the case value");
              if (cases.some((c) => c.value === v)) compileError(line, `duplicate case value ${v}`);
              cases.push({ value: v, at: body.length });
            } else if (this.eat("default")) {
              this.expect(":", "after default");
              cases.push({ value: null, at: body.length });
            } else body.push(this.statement());
          }
          return { k: "switch", e, body, cases, line };
        }
        case "break":
          this.next();
          this.expect(";", "after break");
          return { k: "break", line };
        case "continue":
          this.next();
          this.expect(";", "after continue");
          return { k: "continue", line };
        case "return": {
          this.next();
          if (this.eat(";")) return { k: "return", line };
          const e = this.expr();
          this.expect(";", "after the return value");
          return { k: "return", e, line };
        }
        case "else":
          compileError(line, "'else' without a previous 'if'");
        case "case":
        case "default":
          compileError(line, `'${t.v}' label not within a switch statement`);
        case "goto":
          compileError(line, "goto isn't supported in this course (and rarely needed in C)");
      }
    }
    const e = this.expr();
    this.expect(";", "after the statement");
    return { k: "expr", e, line };
  }

  // ----- expressions, from lowest to highest precedence -----
  expr(): Expr {
    let e = this.assign();
    while (this.is(",")) {
      const line = this.next().line;
      e = { k: "comma", l: e, r: this.assign(), line };
    }
    return e;
  }
  assign(): Expr {
    const l = this.cond();
    const t = this.peek();
    if (t.t === "op" && ["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="].includes(t.v)) {
      this.next();
      return { k: "asg", op: t.v, l, r: this.assign(), line: t.line };
    }
    return l;
  }
  cond(): Expr {
    const c = this.binary(0);
    if (this.is("?")) {
      const line = this.next().line;
      const a = this.expr();
      this.expect(":", "in the ?: expression");
      return { k: "cond", c, a, b: this.cond(), line };
    }
    return c;
  }
  static LEVELS = [["||"], ["&&"], ["|"], ["^"], ["&"], ["==", "!="], ["<", ">", "<=", ">="], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]];
  binary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.unary();
    let l = this.binary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && Parser.LEVELS[level].includes(t.v)) {
        this.next();
        l = { k: "bin", op: t.v, l, r: this.binary(level + 1), line: t.line };
      } else return l;
    }
  }
  unary(): Expr {
    const t = this.peek();
    if (t.t === "op") {
      if (t.v === "++" || t.v === "--") {
        this.next();
        return { k: "pre", op: t.v, e: this.unary(), line: t.line };
      }
      if (["-", "+", "!", "~", "*", "&"].includes(t.v)) {
        this.next();
        return { k: "un", op: t.v, e: this.unary(), line: t.line };
      }
      // (int) x
      if (t.v === "(" && this.startsType(1)) {
        this.next();
        let ct = this.baseType();
        while (this.eat("*")) {
          ct = ptr(ct);
          while (this.eat("const"));
        }
        this.expect(")", "after the type");
        return { k: "cast", t: ct, e: this.unary(), line: t.line };
      }
    }
    if (t.t === "id" && t.v === "sizeof") {
      this.next();
      if (this.is("(") && this.startsType(1)) {
        this.next();
        let st = this.baseType();
        while (this.eat("*")) st = ptr(st);
        this.expect(")");
        return { k: "sizeof", t: st, line: t.line };
      }
      return { k: "sizeof", e: this.unary(), line: t.line };
    }
    return this.postfix();
  }
  postfix(): Expr {
    let e = this.primary();
    for (;;) {
      const t = this.peek();
      if (this.eat("[")) {
        const i = this.expr();
        this.expect("]");
        e = { k: "idx", a: e, i, line: t.line };
      } else if (this.is(".") || this.is("->")) {
        const arrow = this.next().v === "->";
        e = { k: "mem", o: e, name: this.ident(), arrow, line: t.line };
      } else if (this.is("++") || this.is("--")) {
        this.next();
        e = { k: "post", op: t.v, e, line: t.line };
      } else if (this.is("(")) {
        this.next();
        const args: Expr[] = [];
        if (!this.eat(")")) {
          do args.push(this.assign());
          while (this.eat(","));
          this.expect(")", "after the arguments");
        }
        // f(x) calls a function by name; op(x), (*op)(x) and ops[i](x) call through a pointer
        e = e.k === "id" ? { k: "call", name: e.name, args, line: t.line } : { k: "call", name: "", args, line: t.line, callee: e };
      } else return e;
    }
  }
  primary(): Expr {
    const t = this.next();
    if (t.t === "num") return { k: "num", v: t.n!, t: t.isFloat ? DOUBLE : INT, line: t.line };
    if (t.t === "chr") return { k: "num", v: t.n!, t: CHAR, line: t.line };
    if (t.t === "str") {
      let s = t.v;
      while (this.peek().t === "str") s += this.next().v; // "a" "b" joins up
      return { k: "str", s, line: t.line };
    }
    if (t.t === "id") {
      if (TYPE_WORDS.has(t.v)) compileError(t.line, `expected an expression before '${t.v}'`);
      const ev = this.enumConsts.get(t.v);
      if (ev !== undefined) return { k: "num", v: ev, t: INT, line: t.line };
      return { k: "id", name: t.v, line: t.line };
    }
    if (t.v === "(") {
      const e = this.expr();
      this.expect(")");
      return e;
    }
    compileError(t.line, `expected an expression before ${t.t === "eof" ? "end of input" : `'${t.v}'`}`);
  }
}

// char s[] = "hi" and int a[] = {1, 2, 3} get their length from the initializer
function fixArrayLength(d: Decl) {
  if (d.type.k !== "array" || d.type.len !== -1) return;
  if (!d.init) compileError(d.line, `array size missing in '${d.name}'`);
  if (d.init.k === "list") d.type = { ...d.type, len: d.init.items.length };
  else if (d.init.e.k === "str") d.type = { ...d.type, len: d.init.e.s.length + 1 };
  else compileError(d.line, `invalid initializer for array '${d.name}'`);
}

function constValue(e: Expr): number | null {
  if (e.k === "num") return e.v;
  if (e.k === "un" && e.op === "-") {
    const v = constValue(e.e);
    return v === null ? null : -v;
  }
  if (e.k === "bin") {
    const a = constValue(e.l);
    const b = constValue(e.r);
    if (a === null || b === null) return null;
    switch (e.op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return b === 0 ? null : Math.trunc(a / b);
    }
  }
  return null;
}

// ---------- Interpreter ----------

type Value = { t: CType; v: number };
type LVal = { addr: number; t: CType };
type Scope = Map<string, LVal>;

const GLOBAL_BASE = 1000; // addresses below this are never valid: a NULL pointer crashes
const STRING_BASE = 500000;
const STACK_BASE = 100000;
const FILE_BASE = 1_000_000; // FILE * values (never memory addresses)
const HEAP_BASE = 600000; // malloc hands out memory from here
const FUNC_BASE = 2_000_000; // pointers to functions (never memory addresses)
const MEM_LIMIT = 1_000_000;

type Block = { start: number; size: number; bytes: number; freed: boolean; line: number };

export function runC(source: string, inputs: (number | string)[] = []): RunResult {
  let output = "";
  const write = (s: string) => {
    output += s;
    if (output.length > MAX_OUTPUT) throw new RuntimeError("Output limit exceeded: the program printed too much. Check your loops.");
  };
  try {
    const toks = tokenize(preprocess(source));
    const parsed = new Parser(toks).program();
    const main = parsed.funcs.get("main");
    if (!main || !main.body) throw new CompileError("ld: error: undefined reference to 'main'. Every C program needs int main()");
    const vm = new Machine(parsed.funcs, write, inputs.map(String).join("\n") + (inputs.length ? "\n" : ""));
    vm.initGlobals(parsed.globals);
    try {
      vm.call(main, main.params.length ? vm.mainArgs(commandLine(source), main.line) : [], main.line);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    }
    return { output, error: null };
  } catch (e) {
    if (e instanceof CompileError || e instanceof RuntimeError) return { output, error: e.message };
    if (e instanceof ExitSignal) return { output, error: null };
    if (e instanceof RangeError) return { output, error: "Segmentation fault (core dumped): the stack overflowed. Does a function call itself forever?" };
    return { output, error: "Something went wrong running the program." };
  }
}

// A comment like /* $ ./greet ken dennis */ says how the program is started: that's where argv comes from
function commandLine(source: string): string[] {
  const m = source.match(/\/\*\s*\$\s*([^*]*?)\s*\*\//) ?? source.match(/\/\/\s*\$\s*(.*)$/m);
  // In a pipeline like cat words.txt | ./grep un, this program is the last command
  const words = m ? m[1].split("|").pop()!.trim().split(/\s+/).filter(Boolean) : [];
  return words.length ? words : ["./a.out"];
}

// The files a lesson program finds on its little Unix disk
const START_FILES: Record<string, string> = {
  "todo.txt": "edit\ncompile\ntest\n",
  "motd": "welcome to unix\n",
};
type OpenFile = { name: string; mode: string; pos: number; open: boolean };

class Machine {
  mem = new Map<number, number>();
  globals: Scope = new Map();
  scopes: Scope[] = [];
  sp = STACK_BASE;
  gp = GLOBAL_BASE;
  strp = STRING_BASE;
  stringCache = new Map<string, number>();
  steps = 0;
  depth = 0;
  inPos = 0;
  seed = 1;
  valid: [number, number][] = []; // allocated ranges, for catching bad pointers
  hp = HEAP_BASE;
  files = new Map<string, string>(Object.entries(START_FILES));
  handles: OpenFile[] = []; // FILE * values are 1000000 + index; 1, 2 and 3 are stdin, stdout, stderr
  blocks: Block[] = []; // malloc'd blocks, sorted by address
  funcList: Func[];

  constructor(
    private funcs: Map<string, Func>,
    public write: (s: string) => void,
    public stdin: string
  ) {
    this.funcList = [...funcs.values()];
  }

  // A function used as a value (without calling it) is a pointer to it
  isVariable(name: string) {
    return this.scopes.some((sc) => sc.has(name)) || this.globals.has(name);
  }
  funcPointer(name: string): Value {
    const fn = this.funcs.get(name)!;
    return { t: ptr({ k: "fn", ret: fn.ret, params: fn.params.map((p) => p.type) }), v: FUNC_BASE + this.funcList.indexOf(fn) };
  }
  callPointer(p: Value, args: Value[], line: number): Value {
    const target = p.t.k === "ptr" ? p.t.of : p.t;
    if (target.k !== "fn") throw new CompileError(`lesson.c:${line}: error: called object is not a function or function pointer (it's ${typeName(p.t)})`);
    if (p.v === 0) throw new RuntimeError(`Segmentation fault (core dumped): line ${line} calls a NULL function pointer.`);
    const fn = this.funcList[p.v - FUNC_BASE];
    if (!fn) throw new RuntimeError(`Segmentation fault (core dumped): line ${line} calls through a bad function pointer.`);
    if (args.length !== fn.params.length)
      throw new CompileError(`lesson.c:${line}: error: too ${args.length < fn.params.length ? "few" : "many"} arguments to function '${fn.name}'`);
    return this.call(fn, args, line);
  }

  step() {
    if (++this.steps > MAX_STEPS) throw new RuntimeError("Time limit exceeded: the program never stopped. Check your loops.");
  }

  // ----- memory -----
  alloc(t: CType, global = false): number {
    const n = Math.max(1, cells(t));
    const addr = global ? this.gp : this.sp;
    if (global) this.gp += n;
    else {
      this.sp += n;
      if (this.sp > STRING_BASE) throw new RuntimeError("Segmentation fault (core dumped): out of stack memory.");
    }
    // Local variables start with leftover "garbage", like in real C
    for (let i = 0; i < n; i++) this.mem.set(addr + i, global ? 0 : ((addr + i) * 7919) % 32768);
    return addr;
  }
  check(addr: number, line: number) {
    if (Number.isInteger(addr) && addr >= HEAP_BASE && addr < MEM_LIMIT) return this.checkHeap(addr, line);
    if (!Number.isInteger(addr) || addr < GLOBAL_BASE || addr >= MEM_LIMIT || (addr >= this.gp && addr < STACK_BASE) || (addr >= this.sp && addr < STRING_BASE) || addr >= this.strp)
      throw new RuntimeError(`Segmentation fault (core dumped): bad memory access at line ${line}${addr === 0 ? " (a NULL pointer)" : ""}.`);
  }
  load(addr: number, line: number): number {
    this.check(addr, line);
    return this.mem.get(addr) ?? 0;
  }
  store(addr: number, v: number, line: number) {
    this.check(addr, line);
    if (addr >= STRING_BASE && addr < HEAP_BASE) throw new RuntimeError(`Segmentation fault (core dumped): a string constant can't be changed (line ${line}). Copy it into a char array first.`);
    this.mem.set(addr, v);
  }
  // ----- the heap: malloc and free -----
  blockAt(addr: number): Block | undefined {
    let lo = 0;
    let hi = this.blocks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const b = this.blocks[mid];
      if (addr < b.start) hi = mid - 1;
      else if (addr >= b.start + Math.max(b.size, b.bytes)) lo = mid + 1;
      else return b;
    }
    return undefined;
  }
  checkHeap(addr: number, line: number) {
    const b = this.blockAt(addr);
    if (!b) throw new RuntimeError(`Segmentation fault (core dumped): bad memory access at line ${line}.`);
    if (b.freed) throw new RuntimeError(`Segmentation fault (core dumped): the memory at line ${line} was already given back with free(). Using it after free is a bug.`);
    if (addr >= b.start + b.size)
      throw new RuntimeError(`Segmentation fault (core dumped): line ${line} goes past the end of the memory from malloc (line ${b.line}). Did you ask for enough?`);
  }
  malloc(nbytes: number, zero: boolean, line: number): number {
    const n = Math.max(1, Math.ceil(nbytes));
    if (nbytes < 0 || this.hp + n + 1 > MEM_LIMIT) return 0; // out of memory: malloc returns NULL
    const start = this.hp;
    this.hp += n + 1; // a gap between blocks, so running off the end is caught
    for (let i = 0; i < n; i++) this.mem.set(start + i, zero ? 0 : ((start + i) * 7919) % 32768);
    this.blocks.push({ start, size: n, bytes: n, freed: false, line });
    return start;
  }
  free(addr: number, line: number) {
    if (addr === 0) return; // free(NULL) does nothing
    const b = addr >= HEAP_BASE && addr < MEM_LIMIT ? this.blockAt(addr) : undefined;
    if (!b || b.start !== addr) throw new RuntimeError(`free(): invalid pointer\nAborted (core dumped): line ${line} frees something that malloc didn't give you.`);
    if (b.freed) throw new RuntimeError(`free(): double free detected\nAborted (core dumped): line ${line} frees the same memory twice.`);
    b.freed = true;
  }
  // malloc counts bytes, but this machine stores one value per cell. When a fresh
  // void * becomes a typed pointer, shrink the block to the elements that fit.
  typeBlock(addr: number, of: CType) {
    if (addr < HEAP_BASE || of.k === "void") return;
    const b = this.blockAt(addr);
    if (!b || b.start !== addr || b.size !== b.bytes) return;
    b.size = Math.max(Math.floor(b.bytes / bytes(of)), 0) * cells(of);
    if (b.size === 0) b.size = Math.min(1, b.bytes); // too small for even one element
  }
  leaks(): number {
    return this.blocks.filter((b) => !b.freed).length;
  }

  stringAddr(s: string): number {
    const cached = this.stringCache.get(s);
    if (cached !== undefined) return cached;
    const addr = this.strp;
    for (let i = 0; i < s.length; i++) this.mem.set(addr + i, s.charCodeAt(i));
    this.mem.set(addr + s.length, 0);
    this.strp += s.length + 1;
    this.stringCache.set(s, addr);
    return addr;
  }
  readString(addr: number, line: number): string {
    let s = "";
    for (let i = 0; ; i++) {
      const c = this.load(addr + i, line);
      if (c === 0) return s;
      s += String.fromCharCode(c);
      if (i > 100000) throw new RuntimeError("Segmentation fault (core dumped): a string without its closing '\\0'.");
    }
  }

  // ----- variables -----
  lookup(name: string, line: number): LVal {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(name);
      if (v) return v;
    }
    const g = this.globals.get(name);
    if (g) return g;
    if (this.funcs.has(name) || BUILTINS.has(name)) throw new CompileError(`lesson.c:${line}: error: '${name}' is a function: call it with ${name}(…)`);
    throw new CompileError(`lesson.c:${line}: error: '${name}' undeclared (first use in this function)`);
  }
  declare(d: Decl, global: boolean) {
    const scope = global ? this.globals : this.scopes[this.scopes.length - 1];
    if (scope.has(d.name)) throw new CompileError(`lesson.c:${d.line}: error: redefinition of '${d.name}'`);
    const addr = this.alloc(d.type, global);
    scope.set(d.name, { addr, t: d.type });
    if (d.init) this.initialize(addr, d.type, d.init, d.line);
  }
  initialize(addr: number, t: CType, init: Init, line: number): void {
    if (t.k === "array") {
      if (init.k === "expr" && init.e.k === "str" && t.of.k === "char") {
        const s = init.e.s;
        if (s.length > t.len) throw new CompileError(`lesson.c:${line}: error: the string is too long for char[${t.len}]`);
        for (let i = 0; i < t.len; i++) this.mem.set(addr + i, i < s.length ? s.charCodeAt(i) : 0);
        return;
      }
      if (init.k !== "list") throw new CompileError(`lesson.c:${line}: error: an array needs a list in braces, like {1, 2, 3}`);
      if (init.items.length > t.len) throw new CompileError(`lesson.c:${line}: error: too many values for an array of ${t.len}`);
      const size = cells(t.of);
      for (let i = 0; i < t.len; i++) {
        if (i < init.items.length) this.initialize(addr + i * size, t.of, init.items[i], line);
        else for (let c = 0; c < size; c++) this.mem.set(addr + i * size + c, 0);
      }
      return;
    }
    if (t.k === "struct") {
      if (init.k !== "list") {
        const v = this.rvalue(init.e);
        this.assignTo({ addr, t }, v, line);
        return;
      }
      t.def.fields.forEach((f, i) => {
        if (i < init.items.length) this.initialize(addr + f.offset, f.type, init.items[i], line);
        else for (let c = 0; c < cells(f.type); c++) this.mem.set(addr + f.offset + c, 0);
      });
      return;
    }
    if (init.k === "list") {
      if (init.items.length !== 1) throw new CompileError(`lesson.c:${line}: error: too many values in the initializer`);
      return this.initialize(addr, t, init.items[0], line);
    }
    this.mem.set(addr, this.convert(this.rvalue(init.e), t, line).v);
  }
  initGlobals(globals: Decl[]) {
    for (const d of globals) this.declare(d, true);
  }

  // ----- conversions -----
  convert(v: Value, t: CType, line: number): Value {
    if (t.k === "double") {
      if (!isArith(v.t)) throw new CompileError(`lesson.c:${line}: error: can't turn ${typeName(v.t)} into double`);
      return { t, v: v.v };
    }
    if (t.k === "int") {
      if (v.t.k === "ptr") return { t, v: v.v };
      if (!isArith(v.t)) throw new CompileError(`lesson.c:${line}: error: can't turn ${typeName(v.t)} into int`);
      return { t, v: toInt(v.v) };
    }
    if (t.k === "char") {
      if (!isArith(v.t)) throw new CompileError(`lesson.c:${line}: error: can't turn ${typeName(v.t)} into char`);
      return { t, v: (toInt(v.v) << 24) >> 24 };
    }
    if (t.k === "ptr") {
      if (v.t.k === "ptr" && v.t.of.k === "void") this.typeBlock(v.v, t.of);
      if (v.t.k === "ptr" || (isIntegral(v.t) && v.v === 0)) return { t, v: v.v };
      if (isIntegral(v.t)) return { t, v: v.v };
      throw new CompileError(`lesson.c:${line}: error: can't turn ${typeName(v.t)} into ${typeName(t)}`);
    }
    if (t.k === "struct") {
      if (v.t.k !== "struct" || v.t.def !== t.def) throw new CompileError(`lesson.c:${line}: error: incompatible types when assigning to ${typeName(t)}`);
      return v;
    }
    if (t.k === "void") return { t, v: 0 };
    throw new CompileError(`lesson.c:${line}: error: can't assign to an array. Copy it element by element.`);
  }
  assignTo(lv: LVal, v: Value, line: number): Value {
    if (lv.t.k === "array") throw new CompileError(`lesson.c:${line}: error: can't assign to an array. Copy it element by element (or use strcpy for strings).`);
    if (lv.t.k === "struct") {
      const c = this.convert(v, lv.t, line);
      for (let i = 0; i < lv.t.def.cells; i++) this.store(lv.addr + i, this.load(c.v + i, line), line);
      return { t: lv.t, v: lv.addr };
    }
    const c = this.convert(v, lv.t, line);
    this.store(lv.addr, c.v, line);
    return c;
  }

  // ----- expressions -----
  lvalue(e: Expr): LVal {
    switch (e.k) {
      case "id":
        return this.lookup(e.name, e.line);
      case "idx": {
        const base = this.rvalue(e.a);
        const i = this.rvalue(e.i);
        let p = base;
        let n = i;
        if (base.t.k !== "ptr" && i.t.k === "ptr") {
          p = i;
          n = base;
        }
        if (p.t.k !== "ptr") throw new CompileError(`lesson.c:${e.line}: error: subscripted value is neither array nor pointer`);
        if (!isIntegral(n.t)) throw new CompileError(`lesson.c:${e.line}: error: array subscript is not an integer`);
        const addr = p.v + toInt(n.v) * cells(p.t.of);
        this.checkIndex(e, toInt(n.v));
        return { addr, t: p.t.of };
      }
      case "un":
        if (e.op === "*") {
          const p = this.rvalue(e.e);
          if (p.t.k !== "ptr") throw new CompileError(`lesson.c:${e.line}: error: invalid type argument of unary '*' (have '${typeName(p.t)}')`);
          if (p.t.of.k === "void") throw new CompileError(`lesson.c:${e.line}: error: can't use a void * directly`);
          return { addr: p.v, t: p.t.of };
        }
        break;
      case "mem": {
        let base: LVal;
        if (e.arrow) {
          const p = this.rvalue(e.o);
          if (p.t.k !== "ptr" || p.t.of.k !== "struct")
            throw new CompileError(`lesson.c:${e.line}: error: '->' needs a pointer to a struct${p.t.k === "struct" ? " (use '.' for a struct itself)" : ""}`);
          base = { addr: p.v, t: p.t.of };
        } else {
          base = this.lvalue(e.o);
          if (base.t.k !== "struct")
            throw new CompileError(`lesson.c:${e.line}: error: '.' needs a struct${base.t.k === "ptr" ? " (use '->' for a pointer to a struct)" : ""}`);
        }
        const def = (base.t as { k: "struct"; def: StructDef }).def;
        const f = def.fields.find((x) => x.name === e.name);
        if (!f) throw new CompileError(`lesson.c:${e.line}: error: 'struct ${def.name}' has no member named '${e.name}'`);
        return { addr: base.addr + f.offset, t: f.type };
      }
    }
    throw new CompileError(`lesson.c:${e.line}: error: this can't be assigned to (it isn't a variable)`);
  }

  // Real C doesn't check this, but a beginner-friendly message helps: a[5] in int a[5]
  checkIndex(e: Expr & { k: "idx" }, i: number) {
    if (e.a.k !== "id") return;
    let lv: LVal | undefined;
    for (let s = this.scopes.length - 1; s >= 0 && !lv; s--) lv = this.scopes[s].get(e.a.name);
    lv = lv ?? this.globals.get(e.a.name);
    if (lv && lv.t.k === "array" && (i < 0 || i >= lv.t.len))
      throw new RuntimeError(`Segmentation fault (core dumped): ${e.a.name}[${i}] is outside the array (line ${e.line}). ${e.a.name} has ${lv.t.len} elements: ${e.a.name}[0] to ${e.a.name}[${lv.t.len - 1}].`);
  }

  // The value of an expression. Arrays turn into a pointer to their first element.
  rvalue(e: Expr): Value {
    this.step();
    switch (e.k) {
      case "num":
        return { t: e.t, v: e.v };
      case "str":
        return { t: ptr(CHAR), v: this.stringAddr(e.s) };
      case "id":
        if (this.funcs.has(e.name) && !this.isVariable(e.name)) return this.funcPointer(e.name);
        return this.read(this.lvalue(e), e.line);
      case "idx":
      case "mem": {
        const lv = this.lvalue(e);
        return this.read(lv, e.line);
      }
      case "un": {
        if (e.op === "*") {
          // *op for a function pointer is the function itself: (*op)(2, 3)
          if (e.e.k === "id" && this.funcs.has(e.e.name) && !this.isVariable(e.e.name)) return this.funcPointer(e.e.name);
          const p = this.rvalue(e.e);
          if (p.t.k === "ptr" && p.t.of.k === "fn") return p;
          if (p.t.k !== "ptr") throw new CompileError(`lesson.c:${e.line}: error: invalid type argument of unary '*' (have '${typeName(p.t)}')`);
          if (p.t.of.k === "void") throw new CompileError(`lesson.c:${e.line}: error: can't use a void * directly`);
          return this.read({ addr: p.v, t: p.t.of }, e.line);
        }
        if (e.op === "&") {
          if (e.e.k === "id" && this.funcs.has(e.e.name) && !this.isVariable(e.e.name)) return this.funcPointer(e.e.name);
          const lv = this.lvalue(e.e);
          return { t: ptr(lv.t.k === "array" ? lv.t : lv.t), v: lv.addr };
        }
        const v = this.rvalue(e.e);
        if (e.op === "!") return { t: INT, v: truthy(v) ? 0 : 1 };
        if (!isArith(v.t)) throw new CompileError(`lesson.c:${e.line}: error: wrong type argument to unary '${e.op}'`);
        if (e.op === "-") return v.t.k === "double" ? { t: DOUBLE, v: -v.v } : { t: INT, v: toInt(-v.v) };
        if (e.op === "+") return v.t.k === "char" ? { t: INT, v: v.v } : v;
        if (e.op === "~") {
          if (!isIntegral(v.t)) throw new CompileError(`lesson.c:${e.line}: error: wrong type argument to bit-complement`);
          return { t: INT, v: ~v.v };
        }
        break;
      }
      case "pre":
      case "post": {
        const lv = this.lvalue(e.e);
        const old = this.read(lv, e.line);
        const delta = e.op === "++" ? 1 : -1;
        let nv: Value;
        if (old.t.k === "ptr") nv = { t: old.t, v: old.v + delta * cells(old.t.of) };
        else if (isArith(old.t)) nv = { t: old.t, v: old.v + delta };
        else throw new CompileError(`lesson.c:${e.line}: error: wrong type argument to ${e.op}`);
        const stored = this.assignTo(lv, nv, e.line);
        return e.k === "pre" ? stored : old;
      }
      case "bin":
        return this.binary(e);
      case "asg": {
        const lv = this.lvalue(e.l);
        if (e.op === "=") return this.assignTo(lv, this.rvalue(e.r), e.line);
        const cur = this.read(lv, e.line);
        const r = this.rvalue(e.r);
        const res = this.arith(e.op.slice(0, -1), cur, r, e.line);
        return this.assignTo(lv, res, e.line);
      }
      case "cond":
        return truthy(this.rvalue(e.c)) ? this.rvalue(e.a) : this.rvalue(e.b);
      case "comma":
        this.rvalue(e.l);
        return this.rvalue(e.r);
      case "cast": {
        const v = this.rvalue(e.e);
        if (e.t.k === "ptr" && v.t.k === "ptr") {
          if (v.t.of.k === "void") this.typeBlock(v.v, e.t.of);
          return { t: e.t, v: v.v };
        }
        return this.convert(v, e.t, e.line);
      }
      case "sizeof": {
        if (e.t) return { t: INT, v: bytes(e.t) };
        // sizeof doesn't run its operand: look at the type only
        const t = this.typeOf(e.e!);
        return { t: INT, v: bytes(t) };
      }
      case "call":
        return this.callExpr(e);
    }
    throw new CompileError(`lesson.c:${e.line}: error: unsupported expression`);
  }

  typeOf(e: Expr): CType {
    if (e.k === "id" && this.funcs.has(e.name) && !this.isVariable(e.name)) return this.funcPointer(e.name).t;
    if (e.k === "id" || e.k === "idx" || e.k === "mem" || (e.k === "un" && e.op === "*")) return this.lvalue(e).t;
    if (e.k === "str") return { k: "array", of: CHAR, len: e.s.length + 1 };
    const saved = this.steps;
    const t = this.rvalue(e).t;
    this.steps = saved;
    return t;
  }

  read(lv: LVal, line: number): Value {
    if (lv.t.k === "array") return { t: ptr(lv.t.of), v: lv.addr };
    if (lv.t.k === "struct") {
      this.check(lv.addr, line);
      return { t: lv.t, v: lv.addr };
    }
    return { t: lv.t, v: this.load(lv.addr, line) };
  }

  binary(e: Expr & { k: "bin" }): Value {
    if (e.op === "&&") return { t: INT, v: truthy(this.rvalue(e.l)) && truthy(this.rvalue(e.r)) ? 1 : 0 };
    if (e.op === "||") return { t: INT, v: truthy(this.rvalue(e.l)) || truthy(this.rvalue(e.r)) ? 1 : 0 };
    return this.arith(e.op, this.rvalue(e.l), this.rvalue(e.r), e.line);
  }

  arith(op: string, a: Value, b: Value, line: number): Value {
    // pointer arithmetic
    if (a.t.k === "ptr" || b.t.k === "ptr") {
      if (op === "+" && a.t.k === "ptr" && isIntegral(b.t)) return { t: a.t, v: a.v + toInt(b.v) * cells(a.t.of) };
      if (op === "+" && b.t.k === "ptr" && isIntegral(a.t)) return { t: b.t, v: b.v + toInt(a.v) * cells(b.t.of) };
      if (op === "-" && a.t.k === "ptr" && isIntegral(b.t)) return { t: a.t, v: a.v - toInt(b.v) * cells(a.t.of) };
      if (op === "-" && a.t.k === "ptr" && b.t.k === "ptr") return { t: INT, v: Math.trunc((a.v - b.v) / cells(a.t.of)) };
      if (["==", "!=", "<", ">", "<=", ">="].includes(op)) return { t: INT, v: compare(op, a.v, b.v) ? 1 : 0 };
      throw new CompileError(`lesson.c:${line}: error: invalid operands to binary ${op} (have '${typeName(a.t)}' and '${typeName(b.t)}')`);
    }
    if (!isArith(a.t) || !isArith(b.t)) throw new CompileError(`lesson.c:${line}: error: invalid operands to binary ${op} (have '${typeName(a.t)}' and '${typeName(b.t)}')`);
    const real = a.t.k === "double" || b.t.k === "double";
    const x = a.v;
    const y = b.v;
    if (["==", "!=", "<", ">", "<=", ">="].includes(op)) return { t: INT, v: compare(op, x, y) ? 1 : 0 };
    if (real) {
      switch (op) {
        case "+":
          return { t: DOUBLE, v: x + y };
        case "-":
          return { t: DOUBLE, v: x - y };
        case "*":
          return { t: DOUBLE, v: x * y };
        case "/":
          return { t: DOUBLE, v: x / y }; // 1.0 / 0 is inf, like real C
        case "%":
          throw new CompileError(`lesson.c:${line}: error: invalid operands to binary % (have 'double'): % only works with whole numbers`);
        default:
          throw new CompileError(`lesson.c:${line}: error: invalid operands to binary ${op} (have 'double')`);
      }
    }
    switch (op) {
      case "+":
        return { t: INT, v: toInt(x + y) };
      case "-":
        return { t: INT, v: toInt(x - y) };
      case "*":
        return { t: INT, v: Math.imul(x, y) };
      case "/":
        if (y === 0) throw new RuntimeError(`Floating point exception (core dumped): division by zero at line ${line}.`);
        return { t: INT, v: toInt(Math.trunc(x / y)) };
      case "%":
        if (y === 0) throw new RuntimeError(`Floating point exception (core dumped): division by zero at line ${line}.`);
        return { t: INT, v: toInt(x % y) };
      case "&":
        return { t: INT, v: x & y };
      case "|":
        return { t: INT, v: x | y };
      case "^":
        return { t: INT, v: x ^ y };
      case "<<":
        return { t: INT, v: x << y };
      case ">>":
        return { t: INT, v: x >> y };
    }
    throw new CompileError(`lesson.c:${line}: error: unknown operator ${op}`);
  }

  // ----- statements -----
  exec(s: Stmt) {
    this.step();
    switch (s.k) {
      case "block": {
        this.scopes.push(new Map());
        const sp = this.sp;
        try {
          for (const x of s.body) this.exec(x);
        } finally {
          this.scopes.pop();
          this.sp = sp;
        }
        return;
      }
      case "decl":
        for (const d of s.decls) this.declare(d, false);
        return;
      case "expr":
        this.rvalue(s.e);
        return;
      case "if":
        if (truthy(this.rvalue(s.c))) this.exec(s.a);
        else if (s.b) this.exec(s.b);
        return;
      case "while":
        while (truthy(this.rvalue(s.c))) {
          try {
            this.exec(s.body);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (!(e instanceof ContinueSignal)) throw e;
          }
        }
        return;
      case "do":
        do {
          try {
            this.exec(s.body);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (!(e instanceof ContinueSignal)) throw e;
          }
        } while (truthy(this.rvalue(s.c)));
        return;
      case "for": {
        this.scopes.push(new Map());
        const sp = this.sp;
        try {
          if (s.init) this.exec(s.init);
          while (!s.c || truthy(this.rvalue(s.c))) {
            try {
              this.exec(s.body);
            } catch (e) {
              if (e instanceof BreakSignal) break;
              if (!(e instanceof ContinueSignal)) throw e;
            }
            if (s.step) this.rvalue(s.step);
          }
        } finally {
          this.scopes.pop();
          this.sp = sp;
        }
        return;
      }
      case "switch": {
        const v = this.rvalue(s.e);
        if (!isIntegral(v.t)) throw new CompileError(`lesson.c:${s.line}: error: switch quantity not an integer`);
        const hit = s.cases.find((c) => c.value === v.v) ?? s.cases.find((c) => c.value === null);
        if (!hit) return;
        this.scopes.push(new Map());
        try {
          for (let i = hit.at; i < s.body.length; i++) this.exec(s.body[i]);
        } catch (e) {
          if (!(e instanceof BreakSignal)) throw e;
        } finally {
          this.scopes.pop();
        }
        return;
      }
      case "break":
        throw new BreakSignal();
      case "continue":
        throw new ContinueSignal();
      case "return":
        throw new ReturnSignal(s.e ? this.rvalue(s.e) : null);
      case "empty":
        return;
    }
  }

  // ----- functions -----
  call(fn: Func, args: Value[], line: number): Value {
    if (!fn.body) throw new CompileError(`ld: error: undefined reference to '${fn.name}': it's declared but has no body`);
    if (++this.depth > MAX_DEPTH) throw new RuntimeError("Segmentation fault (core dumped): the stack overflowed. Does a function call itself forever?");
    const savedScopes = this.scopes;
    const savedSp = this.sp;
    this.scopes = [new Map()];
    try {
      fn.params.forEach((p, i) => {
        const addr = this.alloc(p.type);
        this.scopes[0].set(p.name, { addr, t: p.type });
        this.assignTo({ addr, t: p.type }, args[i], line);
      });
      this.exec(fn.body);
      if (fn.ret.k !== "void" && fn.name !== "main") return { t: fn.ret, v: 0 }; // fell off the end
      return { t: fn.ret, v: 0 };
    } catch (e) {
      if (e instanceof ReturnSignal) {
        if (fn.ret.k === "void") return { t: VOID, v: 0 };
        if (!e.value) return { t: fn.ret, v: 0 };
        const v = this.convert(e.value, fn.ret, line);
        // A struct return value must survive the end of the function: copy it somewhere safe
        if (fn.ret.k === "struct") {
          const copy = this.alloc(fn.ret, true);
          for (let i = 0; i < fn.ret.def.cells; i++) this.mem.set(copy + i, this.mem.get(v.v + i) ?? 0);
          return { t: fn.ret, v: copy };
        }
        return v;
      }
      if (e instanceof BreakSignal) throw new CompileError(`lesson.c:${line}: error: break statement not within loop or switch`);
      if (e instanceof ContinueSignal) throw new CompileError(`lesson.c:${line}: error: continue statement not within a loop`);
      throw e;
    } finally {
      this.scopes = savedScopes;
      this.sp = savedSp;
      this.depth--;
    }
  }

  callExpr(e: Expr & { k: "call" }): Value {
    if (e.callee || this.isVariable(e.name)) {
      const p = this.rvalue(e.callee ?? { k: "id", name: e.name, line: e.line });
      return this.callPointer(p, e.args.map((a) => this.rvalue(a)), e.line);
    }
    const fn = this.funcs.get(e.name);
    if (fn) {
      if (e.args.length !== fn.params.length)
        throw new CompileError(`lesson.c:${e.line}: error: too ${e.args.length < fn.params.length ? "few" : "many"} arguments to function '${e.name}'`);
      const args = e.args.map((a) => this.rvalue(a));
      return this.call(fn, args, e.line);
    }
    const builtin = BUILTINS.get(e.name);
    if (!builtin) throw new CompileError(`lesson.c:${e.line}: error: implicit declaration of function '${e.name}': there is no function with that name`);
    return builtin(this, e.args, e.line);
  }

  // ----- main(int argc, char *argv[]) -----
  mainArgs(words: string[], line: number): Value[] {
    const argv = this.alloc({ k: "array", of: ptr(CHAR), len: words.length + 1 }, true);
    words.forEach((w, i) => this.mem.set(argv + i, this.stringAddr(w)));
    this.mem.set(argv + words.length, 0);
    return [
      { t: INT, v: words.length },
      { t: ptr(ptr(CHAR)), v: argv },
    ];
  }

  // ----- files -----
  fopen(name: string, mode: string): number {
    if (!/^[rwa]\+?$/.test(mode)) throw new RuntimeError(`fopen: unknown mode "${mode}". Use "r", "w" or "a".`);
    if (mode[0] === "r" && !this.files.has(name)) return 0; // no such file: NULL
    if (mode[0] === "w") this.files.set(name, "");
    if (mode[0] === "a" && !this.files.has(name)) this.files.set(name, "");
    if (this.handles.filter((h) => h.open).length >= 20) return 0; // too many open files
    this.handles.push({ name, mode, pos: 0, open: true });
    return FILE_BASE + this.handles.length - 1;
  }
  handle(f: Value, fn: string, line: number): OpenFile | "stdin" | "stdout" | "stderr" {
    if (f.t.k !== "ptr" || f.t.of.k !== "struct" || f.t.of.def !== FILE_DEF) throw new CompileError(`lesson.c:${line}: error: ${fn} needs a FILE *, not ${typeName(f.t)}`);
    if (f.v === 0) throw new RuntimeError(`Segmentation fault (core dumped): ${fn} at line ${line} got a NULL FILE *. Did fopen fail? Check for NULL.`);
    if (f.v === 1) return "stdin";
    if (f.v === 2) return "stdout";
    if (f.v === 3) return "stderr";
    const h = this.handles[f.v - FILE_BASE];
    if (!h) throw new RuntimeError(`Segmentation fault (core dumped): ${fn} at line ${line} got a bad FILE *.`);
    if (!h.open) throw new RuntimeError(`${fn} at line ${line}: the file ${h.name} was already closed with fclose.`);
    return h;
  }
  writeTo(f: Value, text: string, fn: string, line: number) {
    const h = this.handle(f, fn, line);
    if (h === "stdout" || h === "stderr") return this.write(text);
    if (h === "stdin" || h.mode === "r") throw new RuntimeError(`${fn} at line ${line}: this file was opened for reading ("r"), not writing.`);
    this.files.set(h.name, (this.files.get(h.name) ?? "") + text);
    if (this.files.get(h.name)!.length > MAX_OUTPUT) throw new RuntimeError("File too big: the program wrote too much. Check your loops.");
  }
  // Run a reading function with a file as its input instead of stdin
  readFrom<T>(f: Value, fn: string, line: number, read: () => T): T {
    const h = this.handle(f, fn, line);
    if (h === "stdin") return read();
    if (h === "stdout" || h === "stderr" || h.mode[0] !== "r" && !h.mode.includes("+")) throw new RuntimeError(`${fn} at line ${line}: this file was opened for writing, not reading. Open it with "r".`);
    const saved = [this.stdin, this.inPos] as const;
    this.stdin = this.files.get(h.name) ?? "";
    this.inPos = h.pos;
    try {
      return read();
    } finally {
      h.pos = this.inPos;
      [this.stdin, this.inPos] = saved;
    }
  }

  // ----- input -----
  getc(): number {
    if (this.inPos >= this.stdin.length) return -1; // EOF
    return this.stdin.charCodeAt(this.inPos++);
  }
  skipSpace() {
    while (this.inPos < this.stdin.length && /\s/.test(this.stdin[this.inPos])) this.inPos++;
  }
}

function toInt(v: number): number {
  return Math.trunc(v) | 0;
}
function truthy(v: Value): boolean {
  return v.v !== 0;
}
function compare(op: string, a: number, b: number): boolean {
  switch (op) {
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case "<":
      return a < b;
    case ">":
      return a > b;
    case "<=":
      return a <= b;
    default:
      return a >= b;
  }
}

// ---------- printf ----------

function formatC(m: Machine, fmt: string, args: Value[], line: number): string {
  let out = "";
  let ai = 0;
  const nextArg = (spec: string): Value => {
    if (ai >= args.length) throw new RuntimeError(`printf at line ${line}: %${spec} has no value to print. Add one after the format string.`);
    return args[ai++];
  };
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== "%") {
      out += c;
      continue;
    }
    const m2 = fmt.slice(i).match(/^%([-+ 0#]*)(\d+|\*)?(?:\.(\d+|\*))?(hh|h|ll|l|L)?([diufFeEgGxXocsp%])/);
    if (!m2) throw new RuntimeError(`printf at line ${line}: unknown format "${fmt.slice(i, i + 3)}"`);
    i += m2[0].length - 1;
    const flags = m2[1];
    let width = m2[2] === "*" ? toInt(nextArg("*").v) : m2[2] ? parseInt(m2[2], 10) : 0;
    const precRaw = m2[3] === "*" ? String(toInt(nextArg("*").v)) : m2[3];
    const prec = precRaw !== undefined ? parseInt(precRaw, 10) : undefined;
    const conv = m2[5];
    let s = "";
    if (conv === "%") {
      out += "%";
      continue;
    }
    const arg = nextArg(conv);
    switch (conv) {
      case "d":
      case "i":
      case "u": {
        if (arg.t.k === "double") throw new RuntimeError(`printf at line ${line}: %${conv} needs a whole number, but got a double. Use %f, or (int) to convert.`);
        let n = toInt(arg.v);
        if (conv === "u" && n < 0) n += 2 ** 32;
        s = String(Math.abs(n));
        if (prec !== undefined) s = s.padStart(prec, "0");
        if (n < 0) s = "-" + s;
        else if (flags.includes("+")) s = "+" + s;
        else if (flags.includes(" ")) s = " " + s;
        break;
      }
      case "f":
      case "F": {
        if (arg.t.k !== "double") throw new RuntimeError(`printf at line ${line}: %f needs a double, but got ${typeName(arg.t)}. Use %d, or write 5.0 instead of 5.`);
        s = fixed(arg.v, prec ?? 6);
        if (flags.includes("+") && arg.v >= 0) s = "+" + s;
        break;
      }
      case "e":
      case "E": {
        if (arg.t.k !== "double") throw new RuntimeError(`printf at line ${line}: %e needs a double, but got ${typeName(arg.t)}.`);
        s = expo(arg.v, prec ?? 6);
        if (conv === "E") s = s.toUpperCase();
        break;
      }
      case "g":
      case "G": {
        if (arg.t.k !== "double") throw new RuntimeError(`printf at line ${line}: %g needs a double, but got ${typeName(arg.t)}.`);
        const p = prec === 0 ? 1 : prec ?? 6;
        const exp = arg.v === 0 ? 0 : Math.floor(Math.log10(Math.abs(arg.v)));
        if (exp < -4 || exp >= p) s = expo(arg.v, p - 1).replace(/\.?0+e/, "e");
        else s = fixed(arg.v, Math.max(0, p - 1 - exp)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
        break;
      }
      case "x":
      case "X":
      case "o": {
        let n = toInt(arg.v);
        if (n < 0) n += 2 ** 32;
        s = n.toString(conv === "o" ? 8 : 16);
        if (conv === "X") s = s.toUpperCase();
        if (prec !== undefined) s = s.padStart(prec, "0");
        if (flags.includes("#") && n !== 0) s = (conv === "o" ? "0" : conv === "x" ? "0x" : "0X") + s;
        break;
      }
      case "c":
        if (!isIntegral(arg.t)) throw new RuntimeError(`printf at line ${line}: %c needs a char.`);
        s = String.fromCharCode(toInt(arg.v) & 0xff);
        break;
      case "s": {
        if (arg.t.k !== "ptr") throw new RuntimeError(`printf at line ${line}: %s needs a string (a char array or char *), but got ${typeName(arg.t)}.`);
        s = m.readString(arg.v, line);
        if (prec !== undefined) s = s.slice(0, prec);
        break;
      }
      case "p":
        s = "0x" + (arg.v * 4).toString(16).padStart(6, "0");
        break;
    }
    if (s.length < width) {
      if (flags.includes("-")) s = s.padEnd(width, " ");
      else if (flags.includes("0") && "diufFeEgGxXo".includes(conv) && prec === undefined) {
        const sign = /^[+\- ]/.test(s) ? s[0] : "";
        s = sign + s.slice(sign.length).padStart(width - sign.length, "0");
      } else s = s.padStart(width, " ");
    }
    width = 0;
    out += s;
  }
  if (ai < args.length) {
    // real compilers only warn here; mention it, it's a common mistake
  }
  return out;
}

function fixed(v: number, digits: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf";
  // Exact halves round to the even digit, like printf does (2.25 with %.1f is 2.2)
  const scaled = Math.abs(v) * 10 ** digits;
  let text: string;
  if (scaled < 1e15 && scaled % 1 === 0.5) {
    let n = Math.floor(scaled);
    if (n % 2 === 1) n++;
    text = (n / 10 ** digits).toFixed(digits);
  } else text = Math.abs(v).toFixed(digits);
  return (v < 0 && Number(text) !== 0 ? "-" : "") + text;
}
function expo(v: number, digits: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf";
  const [mant, exp] = v.toExponential(digits).split("e");
  const e = parseInt(exp, 10);
  return `${mant}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}

// ---------- The library ----------

type Builtin = (m: Machine, args: Expr[], line: number) => Value;

function argCount(name: string, args: Expr[], n: number, line: number) {
  if (args.length !== n) throw new CompileError(`lesson.c:${line}: error: too ${args.length < n ? "few" : "many"} arguments to function '${name}'`);
}
function stringArg(m: Machine, e: Expr, name: string, line: number): number {
  const v = m.rvalue(e);
  if (v.t.k !== "ptr") throw new CompileError(`lesson.c:${line}: error: ${name} needs a string here, not ${typeName(v.t)}`);
  return v.v;
}
function numArg(m: Machine, e: Expr, name: string, line: number): number {
  const v = m.rvalue(e);
  if (!isArith(v.t)) throw new CompileError(`lesson.c:${line}: error: ${name} needs a number here, not ${typeName(v.t)}`);
  return v.v;
}
const mathFn = (name: string, f: (x: number) => number): Builtin => (m, args, line) => {
  argCount(name, args, 1, line);
  return { t: DOUBLE, v: f(numArg(m, args[0], name, line)) };
};

const BUILTINS: Map<string, Builtin> = new Map<string, Builtin>([
  [
    "malloc",
    (m, args, line) => {
      argCount("malloc", args, 1, line);
      return { t: ptr(VOID), v: m.malloc(toInt(numArg(m, args[0], "malloc", line)), false, line) };
    },
  ],
  [
    "calloc",
    (m, args, line) => {
      argCount("calloc", args, 2, line);
      const n = toInt(numArg(m, args[0], "calloc", line));
      const size = toInt(numArg(m, args[1], "calloc", line));
      return { t: ptr(VOID), v: m.malloc(n * size, true, line) };
    },
  ],
  [
    "free",
    (m, args, line) => {
      argCount("free", args, 1, line);
      const p = m.rvalue(args[0]);
      if (p.t.k !== "ptr") throw new CompileError(`lesson.c:${line}: error: free needs a pointer, not ${typeName(p.t)}`);
      m.free(p.v, line);
      return { t: VOID, v: 0 };
    },
  ],
  [
    "printf",
    (m, args, line) => {
      if (args.length === 0) throw new CompileError(`lesson.c:${line}: error: printf needs a format string, like printf("hello\\n")`);
      const fmt = m.rvalue(args[0]);
      if (fmt.t.k !== "ptr") throw new CompileError(`lesson.c:${line}: error: the first argument of printf must be a string in "double quotes"`);
      const text = formatC(m, m.readString(fmt.v, line), args.slice(1).map((a) => m.rvalue(a)), line);
      m.write(text);
      return { t: INT, v: text.length };
    },
  ],
  [
    "putchar",
    (m, args, line) => {
      argCount("putchar", args, 1, line);
      const c = toInt(numArg(m, args[0], "putchar", line)) & 0xff;
      m.write(String.fromCharCode(c));
      return { t: INT, v: c };
    },
  ],
  [
    "puts",
    (m, args, line) => {
      argCount("puts", args, 1, line);
      m.write(m.readString(stringArg(m, args[0], "puts", line), line) + "\n");
      return { t: INT, v: 1 };
    },
  ],
  [
    "__stdio",
    (m, args, line) => ({ t: FILE_PTR, v: toInt(m.rvalue(args[0]).v) + 1 }),
  ],
  [
    "fopen",
    (m, args, line) => {
      argCount("fopen", args, 2, line);
      const name = m.readString(stringArg(m, args[0], "fopen", line), line);
      const mode = m.readString(stringArg(m, args[1], "fopen", line), line);
      return { t: FILE_PTR, v: m.fopen(name, mode) };
    },
  ],
  [
    "fclose",
    (m, args, line) => {
      argCount("fclose", args, 1, line);
      const h = m.handle(m.rvalue(args[0]), "fclose", line);
      if (typeof h !== "string") h.open = false;
      return { t: INT, v: 0 };
    },
  ],
  [
    "fprintf",
    (m, args, line) => {
      if (args.length < 2) throw new CompileError(`lesson.c:${line}: error: fprintf needs a file and a format, like fprintf(f, "%d\\n", n)`);
      const f = m.rvalue(args[0]);
      const fmt = m.rvalue(args[1]);
      if (fmt.t.k !== "ptr") throw new CompileError(`lesson.c:${line}: error: the second argument of fprintf must be a string in "double quotes"`);
      const text = formatC(m, m.readString(fmt.v, line), args.slice(2).map((a) => m.rvalue(a)), line);
      m.writeTo(f, text, "fprintf", line);
      return { t: INT, v: text.length };
    },
  ],
  [
    "fputs",
    (m, args, line) => {
      argCount("fputs", args, 2, line);
      const text = m.readString(stringArg(m, args[0], "fputs", line), line);
      m.writeTo(m.rvalue(args[1]), text, "fputs", line);
      return { t: INT, v: 1 };
    },
  ],
  ...["fputc", "putc"].map((name): [string, Builtin] => [
    name,
    (m, args, line) => {
      argCount(name, args, 2, line);
      const c = toInt(numArg(m, args[0], name, line)) & 0xff;
      m.writeTo(m.rvalue(args[1]), String.fromCharCode(c), name, line);
      return { t: INT, v: c };
    },
  ]),
  ...["fgetc", "getc"].map((name): [string, Builtin] => [
    name,
    (m, args, line) => {
      argCount(name, args, 1, line);
      return { t: INT, v: m.readFrom(m.rvalue(args[0]), name, line, () => m.getc()) };
    },
  ]),
  [
    "fgets",
    (m, args, line) => {
      argCount("fgets", args, 3, line);
      const buf = m.rvalue(args[0]);
      if (buf.t.k !== "ptr") throw new CompileError(`lesson.c:${line}: error: fgets needs a char array to read into`);
      const n = toInt(numArg(m, args[1], "fgets", line));
      return m.readFrom(m.rvalue(args[2]), "fgets", line, () => {
        let i = 0;
        while (i < n - 1) {
          const c = m.getc();
          if (c < 0) break;
          m.store(buf.v + i++, c, line);
          if (c === 10) break;
        }
        if (i === 0) return { t: buf.t, v: 0 }; // nothing left: NULL
        m.store(buf.v + i, 0, line);
        return buf;
      });
    },
  ],
  [
    "fscanf",
    (m, args, line) => {
      if (args.length < 2) throw new CompileError(`lesson.c:${line}: error: fscanf needs a file and a format, like fscanf(f, "%d", &n)`);
      return m.readFrom(m.rvalue(args[0]), "fscanf", line, () => BUILTINS.get("scanf")!(m, args.slice(1), line));
    },
  ],
  [
    "feof",
    (m, args, line) => {
      argCount("feof", args, 1, line);
      return { t: INT, v: m.readFrom(m.rvalue(args[0]), "feof", line, () => (m.inPos >= m.stdin.length ? 1 : 0)) };
    },
  ],
  [
    "remove",
    (m, args, line) => {
      argCount("remove", args, 1, line);
      return { t: INT, v: m.files.delete(m.readString(stringArg(m, args[0], "remove", line), line)) ? 0 : -1 };
    },
  ],
  [
    "sprintf",
    (m, args, line) => {
      if (args.length < 2) throw new CompileError(`lesson.c:${line}: error: sprintf needs a char array and a format, like sprintf(buf, "%d", n)`);
      const buf = stringArg(m, args[0], "sprintf", line);
      const fmt = m.rvalue(args[1]);
      if (fmt.t.k !== "ptr") throw new CompileError(`lesson.c:${line}: error: the second argument of sprintf must be a string in "double quotes"`);
      const text = formatC(m, m.readString(fmt.v, line), args.slice(2).map((a) => m.rvalue(a)), line);
      for (let i = 0; i <= text.length; i++) m.store(buf + i, i < text.length ? text.charCodeAt(i) : 0, line);
      return { t: INT, v: text.length };
    },
  ],
  [
    "snprintf",
    (m, args, line) => {
      if (args.length < 3) throw new CompileError(`lesson.c:${line}: error: snprintf needs a char array, its size and a format`);
      const buf = stringArg(m, args[0], "snprintf", line);
      const n = toInt(numArg(m, args[1], "snprintf", line));
      const fmt = m.rvalue(args[2]);
      if (fmt.t.k !== "ptr") throw new CompileError(`lesson.c:${line}: error: the third argument of snprintf must be a string in "double quotes"`);
      const text = formatC(m, m.readString(fmt.v, line), args.slice(3).map((a) => m.rvalue(a)), line);
      if (n > 0) {
        const kept = text.slice(0, n - 1);
        for (let i = 0; i <= kept.length; i++) m.store(buf + i, i < kept.length ? kept.charCodeAt(i) : 0, line);
      }
      return { t: INT, v: text.length };
    },
  ],
  [
    "sscanf",
    (m, args, line) => {
      if (args.length < 2) throw new CompileError(`lesson.c:${line}: error: sscanf needs a string and a format, like sscanf(s, "%d", &n)`);
      const text = m.readString(stringArg(m, args[0], "sscanf", line), line);
      const saved = [m.stdin, m.inPos] as const;
      m.stdin = text;
      m.inPos = 0;
      try {
        return BUILTINS.get("scanf")!(m, args.slice(1), line);
      } finally {
        [m.stdin, m.inPos] = saved;
      }
    },
  ],
  [
    "strdup",
    (m, args, line) => {
      argCount("strdup", args, 1, line);
      const src = m.readString(stringArg(m, args[0], "strdup", line), line);
      const p = m.malloc(src.length + 1, false, line);
      if (p === 0) return { t: ptr(CHAR), v: 0 };
      for (let i = 0; i <= src.length; i++) m.store(p + i, i < src.length ? src.charCodeAt(i) : 0, line);
      return { t: ptr(CHAR), v: p };
    },
  ],
  [
    "strchr",
    (m, args, line) => {
      argCount("strchr", args, 2, line);
      const sp = stringArg(m, args[0], "strchr", line);
      const c = toInt(numArg(m, args[1], "strchr", line)) & 0xff;
      const str = m.readString(sp, line);
      const at = c === 0 ? str.length : str.indexOf(String.fromCharCode(c));
      return { t: ptr(CHAR), v: at < 0 ? 0 : sp + at };
    },
  ],
  [
    "strncmp",
    (m, args, line) => {
      argCount("strncmp", args, 3, line);
      const n = toInt(numArg(m, args[2], "strncmp", line));
      const a = m.readString(stringArg(m, args[0], "strncmp", line), line).slice(0, n);
      const b = m.readString(stringArg(m, args[1], "strncmp", line), line).slice(0, n);
      return { t: INT, v: a === b ? 0 : a < b ? -1 : 1 };
    },
  ],
  [
    // qsort(array, count, size of one element, compare function), from stdlib.h
    "qsort",
    (m, args, line) => {
      argCount("qsort", args, 4, line);
      const base = m.rvalue(args[0]);
      if (base.t.k !== "ptr") throw new CompileError(`lesson.c:${line}: error: qsort needs the array to sort as its first argument`);
      const n = toInt(numArg(m, args[1], "qsort", line));
      const size = toInt(numArg(m, args[2], "qsort", line));
      const cmp = m.rvalue(args[3]);
      if (cmp.t.k !== "ptr" || cmp.t.of.k !== "fn") throw new CompileError(`lesson.c:${line}: error: the last argument of qsort must be a compare function`);
      const elem = base.t.of.k === "void" ? null : base.t.of;
      if (elem && bytes(elem) !== size)
        throw new RuntimeError(`qsort at line ${line}: the size ${size} doesn't match one element (${bytes(elem)} bytes). Use sizeof(${typeName(elem)}) or sizeof a[0].`);
      const step = elem ? cells(elem) : 1;
      const at = (i: number): Value => ({ t: ptr(VOID), v: base.v + i * step });
      const swap = (i: number, j: number) => {
        for (let c = 0; c < step; c++) {
          const x = m.load(base.v + i * step + c, line);
          m.store(base.v + i * step + c, m.load(base.v + j * step + c, line), line);
          m.store(base.v + j * step + c, x, line);
        }
      };
      // insertion sort: it calls the compare function just like the real one does
      for (let i = 1; i < n; i++)
        for (let j = i; j > 0 && toInt(m.callPointer(cmp, [at(j - 1), at(j)], line).v) > 0; j--) swap(j - 1, j);
      return { t: VOID, v: 0 };
    },
  ],
  [
    "atoi",
    (m, args, line) => {
      argCount("atoi", args, 1, line);
      const t = m.readString(stringArg(m, args[0], "atoi", line), line).match(/^\s*[+-]?\d+/);
      return { t: INT, v: t ? toInt(parseInt(t[0], 10)) : 0 };
    },
  ],
  [
    "getchar",
    (m, args, line) => {
      argCount("getchar", args, 0, line);
      return { t: INT, v: m.getc() };
    },
  ],
  [
    "scanf",
    (m, args, line) => {
      if (args.length === 0) throw new CompileError(`lesson.c:${line}: error: scanf needs a format string, like scanf("%d", &n)`);
      const fmt = m.readString(stringArg(m, args[0], "scanf", line), line);
      const targets = args.slice(1);
      let ti = 0;
      let count = 0;
      const stdin = m.stdin;
      for (let i = 0; i < fmt.length; i++) {
        const c = fmt[i];
        if (/\s/.test(c)) {
          m.skipSpace();
          continue;
        }
        if (c !== "%") {
          m.skipSpace();
          if (stdin[m.inPos] === c) m.inPos++;
          else return { t: INT, v: count };
          continue;
        }
        const spec = fmt.slice(i).match(/^%(\d*)(l|h)?([dfcsi])/);
        if (!spec) throw new RuntimeError(`scanf at line ${line}: unknown format "${fmt.slice(i, i + 3)}"`);
        i += spec[0].length - 1;
        if (ti >= targets.length) throw new RuntimeError(`scanf at line ${line}: %${spec[3]} has no variable to store into.`);
        const p = m.rvalue(targets[ti++]);
        if (p.t.k !== "ptr")
          throw new RuntimeError(`Segmentation fault (core dumped): scanf at line ${line} needs the address of a variable. Write &x instead of x.`);
        if (spec[3] === "c") {
          const ch = m.getc();
          if (ch < 0) return { t: INT, v: count || -1 };
          m.store(p.v, ch, line);
          count++;
          continue;
        }
        m.skipSpace();
        if (m.inPos >= stdin.length) return { t: INT, v: count || -1 };
        if (spec[3] === "s") {
          let s = "";
          while (m.inPos < stdin.length && !/\s/.test(stdin[m.inPos])) s += stdin[m.inPos++];
          for (let k = 0; k < s.length; k++) m.store(p.v + k, s.charCodeAt(k), line);
          m.store(p.v + s.length, 0, line);
          count++;
          continue;
        }
        const rest = stdin.slice(m.inPos);
        const num = spec[3] === "f" ? rest.match(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/) : rest.match(/^[+-]?\d+/);
        if (!num) return { t: INT, v: count };
        m.inPos += num[0].length;
        const value = spec[3] === "f" ? parseFloat(num[0]) : parseInt(num[0], 10);
        const target = (p.t as { k: "ptr"; of: CType }).of;
        if (spec[3] === "f" && target.k !== "double") throw new RuntimeError(`scanf at line ${line}: %${spec[2] ?? ""}f needs the address of a double.`);
        if (spec[3] !== "f" && target.k === "double") throw new RuntimeError(`scanf at line ${line}: use %lf to read into a double.`);
        m.store(p.v, target.k === "double" ? value : toInt(value), line);
        count++;
      }
      return { t: INT, v: count };
    },
  ],
  [
    "strlen",
    (m, args, line) => {
      argCount("strlen", args, 1, line);
      return { t: INT, v: m.readString(stringArg(m, args[0], "strlen", line), line).length };
    },
  ],
  [
    "strcpy",
    (m, args, line) => {
      argCount("strcpy", args, 2, line);
      const dst = stringArg(m, args[0], "strcpy", line);
      const src = m.readString(stringArg(m, args[1], "strcpy", line), line);
      for (let i = 0; i <= src.length; i++) m.store(dst + i, i < src.length ? src.charCodeAt(i) : 0, line);
      return { t: ptr(CHAR), v: dst };
    },
  ],
  [
    "strcat",
    (m, args, line) => {
      argCount("strcat", args, 2, line);
      const dst = stringArg(m, args[0], "strcat", line);
      const start = m.readString(dst, line).length;
      const src = m.readString(stringArg(m, args[1], "strcat", line), line);
      for (let i = 0; i <= src.length; i++) m.store(dst + start + i, i < src.length ? src.charCodeAt(i) : 0, line);
      return { t: ptr(CHAR), v: dst };
    },
  ],
  [
    "strcmp",
    (m, args, line) => {
      argCount("strcmp", args, 2, line);
      const a = m.readString(stringArg(m, args[0], "strcmp", line), line);
      const b = m.readString(stringArg(m, args[1], "strcmp", line), line);
      return { t: INT, v: a === b ? 0 : a < b ? -1 : 1 };
    },
  ],
  [
    "strstr",
    (m, args, line) => {
      argCount("strstr", args, 2, line);
      const hay = stringArg(m, args[0], "strstr", line);
      const at = m.readString(hay, line).indexOf(m.readString(stringArg(m, args[1], "strstr", line), line));
      return { t: ptr(CHAR), v: at < 0 ? 0 : hay + at };
    },
  ],
  // ctype.h
  ...(
    [
      ["isdigit", (c: number) => +(c >= 48 && c <= 57)],
      ["isalpha", (c: number) => +((c >= 65 && c <= 90) || (c >= 97 && c <= 122))],
      ["isupper", (c: number) => +(c >= 65 && c <= 90)],
      ["islower", (c: number) => +(c >= 97 && c <= 122)],
      ["isspace", (c: number) => +(c === 32 || (c >= 9 && c <= 13))],
      ["isalnum", (c: number) => +((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))],
      ["toupper", (c: number) => (c >= 97 && c <= 122 ? c - 32 : c)],
      ["tolower", (c: number) => (c >= 65 && c <= 90 ? c + 32 : c)],
    ] as [string, (c: number) => number][]
  ).map(([name, f]): [string, Builtin] => [
    name,
    (m, args, line) => {
      argCount(name, args, 1, line);
      return { t: INT, v: f(toInt(numArg(m, args[0], name, line))) };
    },
  ]),
  [
    "abs",
    (m, args, line) => {
      argCount("abs", args, 1, line);
      return { t: INT, v: Math.abs(toInt(numArg(m, args[0], "abs", line))) };
    },
  ],
  ["sqrt", mathFn("sqrt", Math.sqrt)],
  ["fabs", mathFn("fabs", Math.abs)],
  ["sin", mathFn("sin", Math.sin)],
  ["cos", mathFn("cos", Math.cos)],
  ["exp", mathFn("exp", Math.exp)],
  ["log", mathFn("log", Math.log)],
  ["floor", mathFn("floor", Math.floor)],
  ["ceil", mathFn("ceil", Math.ceil)],
  [
    "pow",
    (m, args, line) => {
      argCount("pow", args, 2, line);
      return { t: DOUBLE, v: Math.pow(numArg(m, args[0], "pow", line), numArg(m, args[1], "pow", line)) };
    },
  ],
  [
    "rand",
    (m, args, line) => {
      argCount("rand", args, 0, line);
      // the classic Unix rand(): the same numbers every run, unless srand changes the start
      m.seed = (m.seed * 1103515245 + 12345) % 2147483648;
      return { t: INT, v: Math.floor(m.seed / 65536) % 32768 };
    },
  ],
  [
    "srand",
    (m, args, line) => {
      argCount("srand", args, 1, line);
      m.seed = toInt(numArg(m, args[0], "srand", line)) >>> 0;
      return { t: VOID, v: 0 };
    },
  ],
  [
    "exit",
    (m, args, line) => {
      argCount("exit", args, 1, line);
      throw new ExitSignal(toInt(numArg(m, args[0], "exit", line)));
    },
  ],
]);
