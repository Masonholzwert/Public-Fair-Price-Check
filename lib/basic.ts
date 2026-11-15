// A small Dartmouth BASIC interpreter.
// Statements: LET, PRINT, REM, END, STOP, GOTO, IF...THEN, FOR/NEXT/STEP,
//             READ, DATA, DIM, GOSUB, RETURN, DEF FN, INPUT, MAT
// Functions:  INT, ABS, SQR, RND, SIN, COS, TAN, ATN, EXP, LOG, and your own FNA ... FNZ
// Text:       variables like N$ and lists like N$(3)

export type RunResult = {
  output: string; // everything the program printed
  error: string | null; // BASIC-style error message, or null if it ran fine
};

type Value = number | string;
type Line = { num: number; text: string };
type BasicError = { basicError: string };
type LoopFrame = { varName: string; end: number; step: number; bodyPc: number };
type UserFunction = { param: string | null; body: string };

const ZONE_WIDTH = 15; // PRINT with a comma jumps to the next 15-character zone
const MAX_STEPS = 200000; // safety limit against endless loops
const MAX_GOSUB_DEPTH = 100; // safety limit against GOSUBs that never RETURN
const MAX_FN_DEPTH = 50; // safety limit against functions that call themselves forever
const DEFAULT_LIST_SIZE = 10; // a list used without DIM has the positions 0 to 10

const FUNCTIONS = ["INT", "ABS", "SQR", "RND", "SIN", "COS", "TAN", "ATN", "EXP", "LOG"];

const STRING_VAR = /^([A-Za-z][0-9]?)\$$/; // N$, A1$
const STRING_LIST = /^([A-Za-z])\$\s*\((.+)\)$/; // N$(3)

// ---------- State of the running program ----------

let vars: Record<string, number> = {}; // number variables like A or X1
let strings: Record<string, string> = {}; // text variables like N$
let lists: Record<string, number[]> = {}; // number lists like A(1), A(2), ...
let stringLists: Record<string, string[]> = {}; // text lists like N$(1), N$(2), ...
let dataValues: Value[] = []; // all values from the DATA lines
let dataPointer = 0; // which DATA value READ takes next
let inputValues: Value[] = []; // what the "user" types when the program asks with INPUT
let inputPointer = 0;
let userFunctions: Record<string, UserFunction> = {}; // DEF FNA(X) = ...
let fnDepth = 0;

// ---------- Main entry ----------

// inputs: the answers given to INPUT, in order (quests use fixed test inputs)
export function runBasic(source: string, inputs: Value[] = []): RunResult {
  let output = "";
  vars = {};
  strings = {};
  lists = {};
  stringLists = {};
  dataValues = [];
  dataPointer = 0;
  inputValues = inputs;
  inputPointer = 0;
  userFunctions = {};
  fnDepth = 0;

  try {
    const lines = parseLines(source);
    checkEnd(lines);
    dataValues = collectData(lines);
    userFunctions = collectFunctions(lines);

    // Line number -> position in the sorted program, used by GOTO, GOSUB and IF...THEN
    const positions = new Map(lines.map((l, i) => [l.num, i]));
    const loops: LoopFrame[] = []; // open FOR loops
    const returnStack: number[] = []; // where each RETURN goes back to
    let pc = 0; // "program counter": index of the line we're running
    let steps = 0;

    while (pc < lines.length) {
      if (++steps > MAX_STEPS) fail("?PROGRAM RAN TOO LONG (ENDLESS LOOP?)");
      const line = lines[pc];
      const { keyword, rest } = splitKeyword(line.text);
      let jumpTo: number | null = null; // set by GOTO, GOSUB, RETURN, IF...THEN, FOR and NEXT

      try {
        switch (keyword) {
          case "REM":
          case "DATA":
          case "DEF":
            break; // comments do nothing, DATA and DEF were collected before the start
          case "END":
          case "STOP":
            return { output, error: null };
          case "LET":
            doLet(rest);
            break;
          case "PRINT":
            output += doPrint(rest, currentColumn(output));
            break;
          case "INPUT":
            output += doInput(rest);
            break;
          case "GOTO":
            jumpTo = findLine(rest, positions);
            break;
          case "GOSUB":
            if (returnStack.length >= MAX_GOSUB_DEPTH) fail("?TOO MANY GOSUBS (MISSING RETURN?)");
            jumpTo = findLine(rest, positions);
            returnStack.push(pc + 1); // come back to the line after the GOSUB
            break;
          case "RETURN":
            if (rest.trim() !== "") fail("?SYNTAX ERROR");
            if (returnStack.length === 0) fail("?RETURN WITHOUT GOSUB");
            jumpTo = returnStack.pop()!;
            break;
          case "IF": {
            const target = doIf(rest);
            if (target !== null) jumpTo = findLine(target, positions);
            break;
          }
          case "FOR":
            jumpTo = doFor(rest, loops, pc, lines);
            break;
          case "NEXT":
            jumpTo = doNext(rest, loops);
            break;
          case "READ":
            doRead(rest);
            break;
          case "DIM":
            doDim(rest);
            break;
          case "MAT":
            output += doMat(rest, currentColumn(output));
            break;
          default:
            fail("?SYNTAX ERROR");
        }
      } catch (e) {
        // Add the line number to the error, like the real thing
        if (isBasicError(e)) fail(`${e.basicError} IN ${line.num}`);
        throw e;
      }

      // Jump if a statement said so, otherwise go to the next line
      pc = jumpTo ?? pc + 1;
    }

    return { output, error: null };
  } catch (e) {
    return { output, error: isBasicError(e) ? e.basicError : "?INTERNAL ERROR" };
  }
}

// ---------- Program structure ----------

function parseLines(source: string): Line[] {
  const map = new Map<number, string>();

  for (const raw of source.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s*(.*)$/);
    if (!match) fail(`?MISSING LINE NUMBER: ${trimmed}`);
    // Same as on the real terminal: retyping a line number replaces that line
    map.set(Number(match[1]), match[2].trim());
  }

  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([num, text]) => ({ num, text }));
}

function checkEnd(lines: Line[]) {
  if (lines.length === 0) fail("?NO PROGRAM");
  const endIndex = lines.findIndex((l) => splitKeyword(l.text).keyword === "END");
  if (endIndex === -1) fail("?NO END INSTRUCTION");
  if (endIndex !== lines.length - 1) fail(`?END IS NOT LAST (LINE ${lines[endIndex].num})`);
}

function splitKeyword(text: string) {
  const match = text.match(/^([A-Za-z]+)\s*(.*)$/);
  if (!match) return { keyword: "", rest: text };
  const word = match[1].toUpperCase();
  // "DEF FNA(X)" and "DEFFNA(X)" both count as DEF
  if (word.startsWith("DEF")) return { keyword: "DEF", rest: text.slice(3).trim() };
  // "GOSUB 100" and "GO SUB 100"
  if (word === "GO" && /^SUB\b/i.test(match[2])) return { keyword: "GOSUB", rest: match[2].slice(3).trim() };
  return { keyword: word, rest: match[2] };
}

// Collect all DATA values from top to bottom before the program starts.
// Values can be numbers, "quoted text" or plain words.
function collectData(lines: Line[]): Value[] {
  const values: Value[] = [];
  for (const line of lines) {
    const { keyword, rest } = splitKeyword(line.text);
    if (keyword !== "DATA") continue;
    for (const raw of splitOutsideQuotes(rest)) {
      const item = raw.trim();
      if (item === "") fail(`?BAD DATA IN ${line.num}`);
      if (item.startsWith('"')) {
        if (!/^"[^"]*"$/.test(item)) fail(`?MISSING QUOTE IN ${line.num}`);
        values.push(item.slice(1, -1));
      } else if (!Number.isNaN(Number(item))) {
        values.push(Number(item));
      } else {
        values.push(item.toUpperCase());
      }
    }
  }
  return values;
}

// Collect all DEF FN lines before the program starts, so functions can be used anywhere
function collectFunctions(lines: Line[]): Record<string, UserFunction> {
  const fns: Record<string, UserFunction> = {};
  for (const line of lines) {
    const { keyword, rest } = splitKeyword(line.text);
    if (keyword !== "DEF") continue;
    const match = rest.match(/^FN\s*([A-Za-z])\s*(?:\(\s*([A-Za-z][0-9]?)\s*\))?\s*=\s*(.+)$/i);
    if (!match) fail(`?BAD DEF IN ${line.num}`);
    const name = "FN" + match[1].toUpperCase();
    if (fns[name]) fail(`?${name} DEFINED TWICE IN ${line.num}`);
    fns[name] = { param: match[2] ? match[2].toUpperCase() : null, body: match[3] };
  }
  return fns;
}

// ---------- Statements ----------

// LET A = 5, LET A(3) = 5, LET N$ = "ADA"
function doLet(rest: string) {
  const equals = rest.indexOf("=");
  if (equals === -1) fail("?SYNTAX ERROR");
  const target = rest.slice(0, equals).trim();
  const expr = rest.slice(equals + 1).trim();
  if (isStringTarget(target)) {
    if (!isStringExpr(expr)) fail("?TYPE MISMATCH (A TEXT VARIABLE NEEDS TEXT)");
    assign(target, evalString(expr));
  } else {
    if (isStringExpr(expr)) fail("?TYPE MISMATCH (TEXT INTO A NUMBER VARIABLE)");
    assign(target, evaluate(expr));
  }
}

// READ A, N$, C(I): take the next values from the DATA lines
function doRead(rest: string) {
  const targets = splitTopLevel(rest);
  if (targets.length === 0) fail("?SYNTAX ERROR");
  for (const target of targets) {
    if (dataPointer >= dataValues.length) fail("?OUT OF DATA");
    assign(target, dataValues[dataPointer++]);
  }
}

// INPUT X or INPUT "QUESTION"; X, N$
// Each value shows up like on the teletype: a question mark and what was typed.
function doInput(rest: string): string {
  let prompt = "";
  let targetText = rest.trim();
  const promptMatch = targetText.match(/^"([^"]*)"\s*[;,]\s*(.+)$/);
  if (promptMatch) {
    prompt = promptMatch[1];
    targetText = promptMatch[2];
  }
  const targets = splitTopLevel(targetText);
  if (targets.length === 0) fail("?SYNTAX ERROR");

  let out = "";
  targets.forEach((target, i) => {
    if (inputPointer >= inputValues.length) {
      fail(`?NO MORE INPUT (THE TEST GIVES ONLY ${inputValues.length} ANSWER${inputValues.length === 1 ? "" : "S"})`);
    }
    const raw = inputValues[inputPointer++];
    out += (i === 0 ? prompt : "") + "? " + String(raw) + "\n";
    if (isStringTarget(target)) {
      assign(target, String(raw));
    } else {
      const value = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (String(raw).trim() === "" || Number.isNaN(value)) fail("?TYPE MISMATCH (A NUMBER WAS EXPECTED)");
      assign(target, value);
    }
  });
  return out;
}

// DIM A(20), N$(5): create lists with positions 0 to the given size
function doDim(rest: string) {
  const parts = splitTopLevel(rest);
  if (parts.length === 0) fail("?SYNTAX ERROR");
  for (const part of parts) {
    const match = part.match(/^([A-Za-z])(\$?)\s*\((\d+)\)$/);
    if (!match) fail("?SYNTAX ERROR");
    const name = match[1].toUpperCase();
    const size = Number(match[3]) + 1;
    if (match[2]) stringLists[name] = new Array(size).fill("");
    else lists[name] = new Array(size).fill(0);
  }
}

// MAT works on whole lists at once (positions 1 to the DIM size):
// MAT READ A, MAT PRINT A, MAT C = A + B, MAT C = A - B, MAT C = A, MAT C = ZER, MAT C = CON
function doMat(rest: string, startColumn: number): string {
  const read = rest.match(/^READ\s+(.+)$/i);
  if (read) {
    for (const name of splitTopLevel(read[1])) {
      const list = getList(checkListName(name));
      for (let i = 1; i < list.length; i++) {
        if (dataPointer >= dataValues.length) fail("?OUT OF DATA");
        const value = dataValues[dataPointer++];
        if (typeof value === "string") fail("?TYPE MISMATCH (TEXT INTO A NUMBER LIST)");
        list[i] = value;
      }
    }
    return "";
  }

  const print = rest.match(/^PRINT\s+(.+)$/i);
  if (print) {
    let out = "";
    let col = startColumn;
    for (const name of splitTopLevel(print[1])) {
      const list = getList(checkListName(name));
      for (let i = 1; i < list.length; i++) {
        const text = formatNumber(list[i]);
        out += text;
        col += text.length;
        if (i < list.length - 1) {
          const pad = ZONE_WIDTH - (col % ZONE_WIDTH);
          out += " ".repeat(pad);
          col += pad;
        }
      }
      out += "\n";
      col = 0;
    }
    return out;
  }

  const calc = rest.match(/^([A-Za-z])\s*=\s*(ZER|CON|[A-Za-z])(?:\s*([+-])\s*([A-Za-z]))?\s*$/i);
  if (calc) {
    const target = calc[1].toUpperCase();
    const source = calc[2].toUpperCase();
    if (source === "ZER" || source === "CON") {
      if (calc[3]) fail("?SYNTAX ERROR");
      const list = getList(target);
      for (let i = 1; i < list.length; i++) list[i] = source === "CON" ? 1 : 0;
      return "";
    }
    const a = getList(source);
    const b = calc[4] ? getList(calc[4].toUpperCase()) : null;
    if (b && b.length !== a.length) fail("?MAT SIZES DON'T MATCH");
    const result = new Array(a.length).fill(0);
    for (let i = 1; i < a.length; i++) {
      result[i] = !b ? a[i] : calc[3] === "+" ? a[i] + b[i] : a[i] - b[i];
    }
    lists[target] = result;
    return "";
  }

  fail("?SYNTAX ERROR");
}

function checkListName(name: string): string {
  if (!/^[A-Za-z]$/.test(name.trim())) fail("?MAT NEEDS A LIST NAME LIKE A");
  return name.trim().toUpperCase();
}

function doPrint(rest: string, startColumn: number): string {
  let out = "";
  let col = startColumn;
  let endsWithSeparator = false;

  for (const { item, sep } of splitPrintItems(rest)) {
    if (item !== "") {
      // Numbers followed by ; get a space after them, so rows like 1 2 3 stay readable
      const text = isStringExpr(item) ? evalString(item) : formatNumber(evaluate(item)) + (sep === ";" ? " " : "");
      out += text;
      col += text.length;
    }
    if (sep === ",") {
      const pad = ZONE_WIDTH - (col % ZONE_WIDTH);
      out += " ".repeat(pad);
      col += pad;
    }
    endsWithSeparator = sep !== null;
  }

  // A trailing , or ; keeps the next PRINT on the same line
  if (!endsWithSeparator) out += "\n";
  return out;
}

function splitPrintItems(rest: string) {
  const parts: { item: string; sep: string | null }[] = [];
  let current = "";
  let inString = false;
  let depth = 0;

  for (const ch of rest) {
    if (ch === '"') inString = !inString;
    if (!inString) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (depth === 0 && (ch === "," || ch === ";")) {
        parts.push({ item: current.trim(), sep: ch });
        current = "";
        continue;
      }
    }
    current += ch;
  }

  if (inString) fail("?MISSING QUOTE");
  if (current.trim() !== "") parts.push({ item: current.trim(), sep: null });
  return parts;
}

function formatNumber(n: number): string {
  // toPrecision avoids ugly results like 0.30000000000000004
  return String(Number(n.toPrecision(9)));
}

function currentColumn(output: string): number {
  return output.length - output.lastIndexOf("\n") - 1;
}

// ---------- Text ----------

// Is this a text expression: "HELLO", N$ or N$(2)?
function isStringExpr(expr: string): boolean {
  const t = expr.trim();
  return t.startsWith('"') || /^[A-Za-z][0-9]?\$/.test(t);
}

function isStringTarget(target: string): boolean {
  const t = target.trim();
  return STRING_VAR.test(t) || STRING_LIST.test(t);
}

function evalString(expr: string): string {
  const t = expr.trim();
  if (t.startsWith('"')) {
    if (!/^"[^"]*"$/.test(t)) fail(t.indexOf('"', 1) === -1 ? "?MISSING QUOTE" : "?SYNTAX ERROR");
    return t.slice(1, -1);
  }
  const variable = t.match(STRING_VAR);
  if (variable) {
    const name = variable[1].toUpperCase();
    if (!(name in strings)) fail(`?UNDEFINED VARIABLE ${name}$`);
    return strings[name];
  }
  const element = t.match(STRING_LIST);
  if (element) {
    const list = getStringList(element[1].toUpperCase());
    return list[checkIndex(list, evaluate(element[2]))];
  }
  fail("?SYNTAX ERROR");
}

// ---------- Variables and lists ----------

// Store a value in a variable (A, X1, N$) or a list element (A(3), N$(I))
function assign(target: string, value: Value) {
  const t = target.trim();

  const textElement = t.match(STRING_LIST);
  if (textElement) {
    const list = getStringList(textElement[1].toUpperCase());
    list[checkIndex(list, evaluate(textElement[2]))] = typeof value === "number" ? formatNumber(value) : value;
    return;
  }
  const textVariable = t.match(STRING_VAR);
  if (textVariable) {
    strings[textVariable[1].toUpperCase()] = typeof value === "number" ? formatNumber(value) : value;
    return;
  }

  if (typeof value === "string") fail("?TYPE MISMATCH (TEXT INTO A NUMBER VARIABLE)");

  const listMatch = t.match(/^([A-Za-z])\s*\((.+)\)$/);
  if (listMatch) {
    const list = getList(listMatch[1].toUpperCase());
    list[checkIndex(list, evaluate(listMatch[2]))] = value;
    return;
  }

  if (/^[A-Za-z]{2,}/.test(t)) fail("?BAD VARIABLE NAME");
  if (!/^[A-Za-z][0-9]?$/.test(t)) fail("?SYNTAX ERROR");
  vars[t.toUpperCase()] = value;
}

// Lists used without DIM are created automatically with positions 0 to 10
function getList(name: string): number[] {
  if (!lists[name]) lists[name] = new Array(DEFAULT_LIST_SIZE + 1).fill(0);
  return lists[name];
}

function getStringList(name: string): string[] {
  if (!stringLists[name]) stringLists[name] = new Array(DEFAULT_LIST_SIZE + 1).fill("");
  return stringLists[name];
}

function checkIndex(list: unknown[], value: number): number {
  const index = Math.floor(value);
  if (index < 0 || index >= list.length) fail(`?INDEX ${index} OUT OF RANGE`);
  return index;
}

// Split "A, B(I, 2), C" at commas that are not inside parentheses
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

// Split DATA items at commas that are not inside quotes
function splitOutsideQuotes(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inString = false;
  for (const ch of text) {
    if (ch === '"') inString = !inString;
    if (ch === "," && !inString) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

// ---------- Jumps ----------

// Turn "50" into the position of line 50 in the program
function findLine(text: string, positions: Map<number, number>): number {
  const match = text.trim().match(/^(\d+)$/);
  if (!match) fail("?SYNTAX ERROR");
  const target = positions.get(Number(match[1]));
  if (target === undefined) fail(`?UNDEFINED LINE ${match[1]}`);
  return target;
}

// IF <expr> <compare> <expr> THEN <line>
// Works with numbers and with text (A$ = "YES"). Returns the target line if true, otherwise null.
function doIf(rest: string): string | null {
  const match = rest.match(/^(.+?)\s*(<>|<=|>=|=|<|>)\s*(.+?)\s+THEN\s*(.+)$/i);
  if (!match) fail("?SYNTAX ERROR");
  const [, leftText, op, rightText, target] = match;

  // In 1964 BASIC, THEN is always followed by a line number
  if (!/^\d+$/.test(target.trim())) fail("?THEN NEEDS A LINE NUMBER");

  const leftIsText = isStringExpr(leftText);
  if (leftIsText !== isStringExpr(rightText)) fail("?TYPE MISMATCH (COMPARING TEXT WITH A NUMBER)");
  const left: Value = leftIsText ? evalString(leftText) : evaluate(leftText);
  const right: Value = leftIsText ? evalString(rightText) : evaluate(rightText);

  let result = false;
  switch (op) {
    case "=": result = left === right; break;
    case "<>": result = left !== right; break;
    case "<": result = left < right; break;
    case ">": result = left > right; break;
    case "<=": result = left <= right; break;
    case ">=": result = left >= right; break;
  }

  return result ? target.trim() : null;
}

// ---------- Loops ----------

// FOR I = 1 TO 10 [STEP 2]
function doFor(rest: string, loops: LoopFrame[], pc: number, lines: Line[]): number | null {
  const match = rest.match(/^([A-Za-z][0-9]?)\s*=\s*(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i);
  if (!match) fail("?SYNTAX ERROR");

  const name = match[1].toUpperCase();
  const start = evaluate(match[2]);
  const end = evaluate(match[3]);
  const step = match[4] ? evaluate(match[4]) : 1;
  if (step === 0) fail("?STEP CANNOT BE 0");

  vars[name] = start;

  // If this loop was already open (an inner loop starting again), forget the old one
  const existing = loops.findIndex((f) => f.varName === name);
  if (existing !== -1) loops.splice(existing);

  // Start is already past the end: skip the loop and continue after its NEXT
  if (step > 0 ? start > end : start < end) {
    const nextPattern = new RegExp(`^NEXT\\s+${name}\\s*$`, "i");
    const nextIndex = lines.findIndex((l, i) => i > pc && nextPattern.test(l.text));
    if (nextIndex === -1) fail("?FOR WITHOUT NEXT");
    return nextIndex + 1;
  }

  loops.push({ varName: name, end, step, bodyPc: pc + 1 });
  return null;
}

// NEXT I: count up (or down) and jump back if the loop isn't finished
function doNext(rest: string, loops: LoopFrame[]): number | null {
  const name = rest.trim().toUpperCase();
  if (!/^[A-Z][0-9]?$/.test(name)) fail("?SYNTAX ERROR");

  const index = loops.map((f) => f.varName).lastIndexOf(name);
  if (index === -1) fail("?NEXT WITHOUT FOR");

  loops.splice(index + 1); // forget inner loops that were left open
  const frame = loops[index];
  vars[name] = vars[name] + frame.step;

  const continues = frame.step > 0 ? vars[name] <= frame.end : vars[name] >= frame.end;
  if (continues) return frame.bodyPc;

  loops.pop(); // loop finished
  return null;
}

// ---------- Expressions ----------

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  const s = expr.trim();
  let i = 0;

  while (i < s.length) {
    const ch = s[i];
    if (ch === " ") {
      i++;
      continue;
    }
    const rest = s.slice(i);

    const num = rest.match(/^(\d+\.?\d*|\.\d+)/);
    if (num) {
      tokens.push(num[0]);
      i += num[0].length;
      continue;
    }

    // Your own function: FNA, FNB, ...
    const fn = rest.match(/^FN\s*([A-Za-z])(?![A-Za-z0-9])/i);
    if (fn) {
      tokens.push("FN" + fn[1].toUpperCase());
      i += fn[0].length;
      continue;
    }

    const name = rest.match(/^[A-Za-z][A-Za-z0-9]*/);
    if (name) {
      if (s[i + name[0].length] === "$") fail("?TYPE MISMATCH (TEXT IN A CALCULATION)");
      const upper = name[0].toUpperCase();
      if (!FUNCTIONS.includes(upper) && !/^[A-Z][0-9]?$/.test(upper)) fail(`?BAD VARIABLE NAME ${upper}`);
      tokens.push(upper);
      i += name[0].length;
      continue;
    }

    if (ch === '"') fail("?TYPE MISMATCH (TEXT IN A CALCULATION)");

    if ("+-*/^()".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === "↑") {
      tokens.push("^"); // the original 1964 power symbol
      i++;
      continue;
    }

    fail("?SYNTAX ERROR");
  }

  return tokens;
}

// Recursive descent parser: each level handles one precedence level
function evaluate(expr: string): number {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // + and - (lowest precedence)
  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  // * and /
  function parseTerm(): number {
    let value = parseUnary();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const right = parseUnary();
      if (op === "/") {
        if (right === 0) fail("?DIVISION BY ZERO");
        value /= right;
      } else {
        value *= right;
      }
    }
    return value;
  }

  // negative numbers like -5
  function parseUnary(): number {
    if (peek() === "-") {
      next();
      return -parseUnary();
    }
    if (peek() === "+") {
      next();
      return parseUnary();
    }
    return parsePower();
  }

  // ^ (highest precedence)
  function parsePower(): number {
    const base = parsePrimary();
    if (peek() === "^") {
      next();
      return Math.pow(base, parseUnary());
    }
    return base;
  }

  // numbers, variables, list elements, functions and parentheses
  function parsePrimary(): number {
    const token = next();
    if (token === undefined) fail("?SYNTAX ERROR");

    if (token === "(") {
      const value = parseExpr();
      if (next() !== ")") fail("?MISSING )");
      return value;
    }

    if (/^[\d.]/.test(token)) return Number(token);

    // Built-in function like SQR(16)
    if (FUNCTIONS.includes(token)) {
      if (next() !== "(") fail("?SYNTAX ERROR");
      const arg = parseExpr();
      if (next() !== ")") fail("?MISSING )");
      return callFunction(token, arg);
    }

    // Your own function like FNA(3)
    if (/^FN[A-Z]$/.test(token)) {
      const fn = userFunctions[token];
      if (!fn) fail(`?UNDEFINED FUNCTION ${token}`);
      let arg: number | null = null;
      if (peek() === "(") {
        next();
        arg = parseExpr();
        if (next() !== ")") fail("?MISSING )");
      }
      if ((fn.param === null) !== (arg === null)) fail(`?WRONG NUMBER OF ARGUMENTS FOR ${token}`);
      return callUserFunction(token, fn, arg);
    }

    if (/^[A-Z][0-9]?$/.test(token)) {
      // List element like A(3)
      if (peek() === "(") {
        if (!/^[A-Z]$/.test(token)) fail(`?BAD LIST NAME ${token}`);
        next();
        const index = parseExpr();
        if (next() !== ")") fail("?MISSING )");
        const list = getList(token);
        return list[checkIndex(list, index)];
      }
      // Simple variable
      if (!(token in vars)) fail(`?UNDEFINED VARIABLE ${token}`);
      return vars[token];
    }

    fail("?SYNTAX ERROR");
  }

  const result = parseExpr();
  if (pos < tokens.length) fail("?SYNTAX ERROR");
  return result;
}

// Run DEF FNA(X) = ...: X is only borrowed while the function runs
function callUserFunction(name: string, fn: UserFunction, arg: number | null): number {
  if (++fnDepth > MAX_FN_DEPTH) fail(`?${name} CALLS ITSELF TOO OFTEN`);
  const param = fn.param;
  const hadValue = param !== null && param in vars;
  const saved = param !== null ? vars[param] : 0;
  try {
    if (param !== null) vars[param] = arg!;
    return evaluate(fn.body);
  } finally {
    if (param !== null) {
      if (hadValue) vars[param] = saved;
      else delete vars[param];
    }
    fnDepth--;
  }
}

function callFunction(name: string, x: number): number {
  switch (name) {
    case "INT":
      return Math.floor(x);
    case "ABS":
      return Math.abs(x);
    case "SQR":
      if (x < 0) fail("?SQUARE ROOT OF A NEGATIVE NUMBER");
      return Math.sqrt(x);
    case "RND":
      return Math.random(); // a random number from 0 up to (but not including) 1
    case "SIN":
      return Math.sin(x);
    case "COS":
      return Math.cos(x);
    case "TAN":
      return Math.tan(x);
    case "ATN":
      return Math.atan(x);
    case "EXP":
      return Math.exp(x);
    case "LOG":
      if (x <= 0) fail("?LOG OF ZERO OR A NEGATIVE NUMBER");
      return Math.log(x);
  }
  fail("?SYNTAX ERROR");
}

// ---------- Errors ----------

function fail(message: string): never {
  throw { basicError: message } as BasicError;
}

function isBasicError(e: unknown): e is BasicError {
  return typeof e === "object" && e !== null && "basicError" in e;
}
