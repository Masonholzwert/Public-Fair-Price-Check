// A small 6502 assembler and CPU, styled after the KIM-1 single-board computer (1976).
//
// - Programs are loaded at $0200 and start there (the first free page on the KIM-1).
// - The program ends at BRK, or at RTS when nothing is left on the stack.
//   Empty memory is $00, which is BRK, so running off the end of a program also stops it.
// - JSR $1EA0 (OUTCH in the KIM-1 ROM) prints the character in A on the teletype.
// - JSR $1E5A (GETCH) reads the next typed key into A. In quests, the keys come from the test.

export type Flags = { n: boolean; v: boolean; d: boolean; i: boolean; z: boolean; c: boolean };

export type MachineState = {
  a: number;
  x: number;
  y: number;
  sp: number;
  flags: Flags;
  mem: Record<string, number>; // every address the program wrote to (except the stack), e.g. { "0300": 7 }
  steps: number; // instructions executed
};

export type AsmRun = { output: string; error: string | null; machine: MachineState | null };

export const ORIGIN = 0x0200;
export const OUTCH = 0x1ea0;
export const GETCH = 0x1e5a; // KIM-1 ROM: wait for a key on the teletype, return it in A
const MAX_STEPS = 200000;

// ---------- Opcodes ----------

type Mode = "imp" | "acc" | "imm" | "zp" | "zpx" | "zpy" | "abs" | "abx" | "aby" | "ind" | "izx" | "izy" | "rel";

const ALU: Mode[] = ["imm", "zp", "zpx", "abs", "abx", "aby", "izx", "izy"];
const alu = (codes: number[]) => Object.fromEntries(ALU.map((m, i) => [m, codes[i]]));
const shift = (acc: number, zp: number, zpx: number, abs: number, abx: number) => ({ acc, zp, zpx, abs, abx });

const OPS: Record<string, Partial<Record<Mode, number>>> = {
  ADC: alu([0x69, 0x65, 0x75, 0x6d, 0x7d, 0x79, 0x61, 0x71]),
  AND: alu([0x29, 0x25, 0x35, 0x2d, 0x3d, 0x39, 0x21, 0x31]),
  CMP: alu([0xc9, 0xc5, 0xd5, 0xcd, 0xdd, 0xd9, 0xc1, 0xd1]),
  EOR: alu([0x49, 0x45, 0x55, 0x4d, 0x5d, 0x59, 0x41, 0x51]),
  LDA: alu([0xa9, 0xa5, 0xb5, 0xad, 0xbd, 0xb9, 0xa1, 0xb1]),
  ORA: alu([0x09, 0x05, 0x15, 0x0d, 0x1d, 0x19, 0x01, 0x11]),
  SBC: alu([0xe9, 0xe5, 0xf5, 0xed, 0xfd, 0xf9, 0xe1, 0xf1]),
  STA: { zp: 0x85, zpx: 0x95, abs: 0x8d, abx: 0x9d, aby: 0x99, izx: 0x81, izy: 0x91 },
  ASL: shift(0x0a, 0x06, 0x16, 0x0e, 0x1e),
  LSR: shift(0x4a, 0x46, 0x56, 0x4e, 0x5e),
  ROL: shift(0x2a, 0x26, 0x36, 0x2e, 0x3e),
  ROR: shift(0x6a, 0x66, 0x76, 0x6e, 0x7e),
  INC: { zp: 0xe6, zpx: 0xf6, abs: 0xee, abx: 0xfe },
  DEC: { zp: 0xc6, zpx: 0xd6, abs: 0xce, abx: 0xde },
  BIT: { zp: 0x24, abs: 0x2c },
  CPX: { imm: 0xe0, zp: 0xe4, abs: 0xec },
  CPY: { imm: 0xc0, zp: 0xc4, abs: 0xcc },
  LDX: { imm: 0xa2, zp: 0xa6, zpy: 0xb6, abs: 0xae, aby: 0xbe },
  LDY: { imm: 0xa0, zp: 0xa4, zpx: 0xb4, abs: 0xac, abx: 0xbc },
  STX: { zp: 0x86, zpy: 0x96, abs: 0x8e },
  STY: { zp: 0x84, zpx: 0x94, abs: 0x8c },
  JMP: { abs: 0x4c, ind: 0x6c },
  JSR: { abs: 0x20 },
  BCC: { rel: 0x90 }, BCS: { rel: 0xb0 }, BEQ: { rel: 0xf0 }, BMI: { rel: 0x30 },
  BNE: { rel: 0xd0 }, BPL: { rel: 0x10 }, BVC: { rel: 0x50 }, BVS: { rel: 0x70 },
  BRK: { imp: 0x00 }, CLC: { imp: 0x18 }, CLD: { imp: 0xd8 }, CLI: { imp: 0x58 }, CLV: { imp: 0xb8 },
  DEX: { imp: 0xca }, DEY: { imp: 0x88 }, INX: { imp: 0xe8 }, INY: { imp: 0xc8 }, NOP: { imp: 0xea },
  PHA: { imp: 0x48 }, PHP: { imp: 0x08 }, PLA: { imp: 0x68 }, PLP: { imp: 0x28 }, RTI: { imp: 0x40 },
  RTS: { imp: 0x60 }, SEC: { imp: 0x38 }, SED: { imp: 0xf8 }, SEI: { imp: 0x78 }, TAX: { imp: 0xaa },
  TAY: { imp: 0xa8 }, TSX: { imp: 0xba }, TXA: { imp: 0x8a }, TXS: { imp: 0x9a }, TYA: { imp: 0x98 },
};

// opcode -> [mnemonic, mode]
const DECODE: [string, Mode][] = [];
for (const [name, modes] of Object.entries(OPS)) {
  for (const [mode, code] of Object.entries(modes)) DECODE[code as number] = [name, mode as Mode];
}

const SIZE: Record<Mode, number> = {
  imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, rel: 2, izx: 2, izy: 2, abs: 3, abx: 3, aby: 3, ind: 3,
};

// ---------- Assembler ----------

class AsmError extends Error {}

const hex = (n: number, digits = 2) => n.toString(16).toUpperCase().padStart(digits, "0");

type Value = { value: number | null; wide: boolean }; // wide: written with 4 hex digits or a label -> absolute

// Numbers: $FF (hex), %1010 (binary), 'A (character), 10 (decimal), or a label / constant name.
// <LABEL and >LABEL give the low and high byte.
function parseValue(text: string, symbols: Map<string, number>, constants: Set<string>, lineNo: number): Value {
  let t = text.trim();
  let part: "lo" | "hi" | null = null;
  if (t.startsWith("<")) (part = "lo"), (t = t.slice(1).trim());
  else if (t.startsWith(">")) (part = "hi"), (t = t.slice(1).trim());

  let value: number | null;
  let wide = false;
  if (/^\$[0-9A-F]+$/i.test(t)) {
    value = parseInt(t.slice(1), 16);
    wide = t.length > 3;
  } else if (/^%[01]+$/.test(t)) {
    value = parseInt(t.slice(1), 2);
  } else if (/^\d+$/.test(t)) {
    value = parseInt(t, 10);
  } else if (/^'.'?$/.test(t)) {
    value = t.charCodeAt(1);
  } else if (/^[A-Z_][A-Z0-9_]*$/i.test(t)) {
    const name = t.toUpperCase();
    value = symbols.has(name) ? symbols.get(name)! : null; // null = not known yet (first pass)
    // Labels are addresses, so they're always used as 16-bit. Small constants (X = $30) can be zero page.
    wide = !constants.has(name) || (value !== null && value > 0xff);
  } else {
    throw new AsmError(`?SYNTAX ERROR IN LINE ${lineNo}: "${text.trim()}" IS NOT A NUMBER`);
  }
  if (value !== null && value > 0xffff) throw new AsmError(`?NUMBER TOO BIG IN LINE ${lineNo}`);
  if (part) {
    wide = false;
    if (value !== null) value = part === "lo" ? value & 0xff : value >> 8;
  }
  return { value, wide };
}

type Operand = { mode: Mode; text: string | null };

function splitOperand(op: string): Operand {
  const t = op.trim();
  if (t === "") return { mode: "imp", text: null };
  if (/^A$/i.test(t)) return { mode: "acc", text: null };
  if (t.startsWith("#")) return { mode: "imm", text: t.slice(1) };
  let m;
  if ((m = t.match(/^\((.+),\s*X\s*\)$/i))) return { mode: "izx", text: m[1] };
  if ((m = t.match(/^\((.+)\)\s*,\s*Y$/i))) return { mode: "izy", text: m[1] };
  if ((m = t.match(/^\((.+)\)$/))) return { mode: "ind", text: m[1] };
  if ((m = t.match(/^(.+),\s*X$/i))) return { mode: "abx", text: m[1] };
  if ((m = t.match(/^(.+),\s*Y$/i))) return { mode: "aby", text: m[1] };
  return { mode: "abs", text: t };
}

// Remove a ; comment, but not a ; inside "text" or a character like ';
function stripComment(raw: string): string {
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === "'" && !quoted) i++; // 'X: skip the character after the quote
    else if (ch === ";" && !quoted) return raw.slice(0, i);
  }
  return raw;
}

// Split ".BYTE 1, 'A, "HI", 0" into its parts, keeping commas inside "text"
function splitData(operand: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < operand.length; i++) {
    const ch = operand[i];
    if (ch === '"') quoted = !quoted;
    if (ch === "'" && !quoted && i + 1 < operand.length) {
      current += ch + operand[++i];
      continue;
    }
    if (ch === "," && !quoted) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

type Line = { lineNo: number; label: string | null; op: string | null; operand: string; raw: string };

function parseLines(source: string): Line[] {
  const lines: Line[] = [];
  source.split("\n").forEach((raw, i) => {
    let text = stripComment(raw).trim(); // comments start with ;
    if (text === "") return;
    let label: string | null = null;
    // "LOOP:" or "LOOP: INX"
    const lm = text.match(/^([A-Z_][A-Z0-9_]*):\s*(.*)$/i);
    if (lm) {
      label = lm[1].toUpperCase();
      text = lm[2];
    } else {
      // A word at the start that isn't an instruction is a label too ("LOOP INX")
      const wm = text.match(/^([A-Z_][A-Z0-9_]*)(\s+(.*))?$/i);
      // Only when an instruction follows, so a typo like "LDAA #5" is reported instead of becoming a label
      const next = (wm?.[3] ?? "").match(/^\.?[A-Z]+/i)?.[0].toUpperCase() ?? "";
      const nextIsOp = !!OPS[next] || [".BYTE", "DCB", ".DB"].includes(next);
      if (wm && !OPS[wm[1].toUpperCase()] && wm[3] && nextIsOp) {
        label = wm[1].toUpperCase();
        text = wm[3] ?? "";
      }
    }
    const om = text.match(/^(\.?[A-Z]+)\s*(.*)$/i);
    lines.push({
      lineNo: i + 1,
      label,
      op: om ? om[1].toUpperCase() : text ? text : null,
      operand: om ? om[2] : "",
      raw: text,
    });
  });
  return lines;
}

// lines: source line number (1-based) for the address where each instruction or data line starts
// labels: address -> label name, so step mode can say "jumps to LOOP"
export type Assembled = { bytes: Map<number, number>; end: number; lines: Map<number, number>; labels: Map<number, string> };

export function assemble(source: string): Assembled {
  const lines = parseLines(source);
  const symbols = new Map<string, number>();
  const constants = new Set<string>();

  // "NAME = $30" defines a constant
  for (const line of lines) {
    const cm = line.raw.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/i);
    if (cm && !line.label) {
      const name = cm[1].toUpperCase();
      const v = parseValue(cm[2], symbols, constants, line.lineNo);
      if (v.value === null) throw new AsmError(`?UNKNOWN NAME IN LINE ${line.lineNo}`);
      symbols.set(name, v.value);
      constants.add(name);
      line.op = null;
    }
  }

  // Which addressing mode and size an instruction gets
  function choose(line: Line, final: boolean): { code: number; mode: Mode; value: number | null } | { data: number[] } {
    const op = line.op!;
    if (op === ".BYTE" || op === "DCB" || op === ".DB") {
      // Numbers, characters ('A) and text ("HELLO" = one byte per letter)
      const data = splitData(line.operand).flatMap((part) => {
        const text = part.match(/^"(.*)"$/);
        if (text) return [...text[1]].map((ch) => ch.charCodeAt(0) & 0xff);
        const v = parseValue(part, symbols, constants, line.lineNo);
        if (final && v.value === null) throw new AsmError(`?UNKNOWN LABEL IN LINE ${line.lineNo}`);
        if ((v.value ?? 0) > 0xff) throw new AsmError(`?BYTE TOO BIG IN LINE ${line.lineNo}: USE $00 TO $FF`);
        return [v.value ?? 0];
      });
      return { data };
    }
    const modes = OPS[op];
    if (!modes) throw new AsmError(`?UNKNOWN INSTRUCTION "${op}" IN LINE ${line.lineNo}`);
    const { mode: written, text } = splitOperand(line.operand);

    // No operand
    if (written === "imp" || written === "acc") {
      if (modes.imp !== undefined) return { code: modes.imp, mode: "imp", value: null };
      if (modes.acc !== undefined) return { code: modes.acc, mode: "acc", value: null };
      throw new AsmError(`?${op} NEEDS A VALUE OR ADDRESS IN LINE ${line.lineNo}`);
    }
    if (modes.imp !== undefined) throw new AsmError(`?${op} TAKES NO VALUE IN LINE ${line.lineNo}`);

    const v = parseValue(text!, symbols, constants, line.lineNo);
    if (final && v.value === null) throw new AsmError(`?UNKNOWN LABEL "${text!.trim().toUpperCase()}" IN LINE ${line.lineNo}`);

    if (modes.rel !== undefined) return { code: modes.rel, mode: "rel", value: v.value };
    if (written === "imm") {
      if (modes.imm === undefined) throw new AsmError(`?${op} CAN'T USE # IN LINE ${line.lineNo}`);
      if ((v.value ?? 0) > 0xff) throw new AsmError(`?VALUE TOO BIG IN LINE ${line.lineNo}: A REGISTER HOLDS $00 TO $FF`);
      return { code: modes.imm, mode: "imm", value: v.value };
    }
    if (written === "ind" || written === "izx" || written === "izy") {
      const code = modes[written];
      if (code === undefined) throw new AsmError(`?${op} CAN'T USE THIS ADDRESS IN LINE ${line.lineNo}`);
      return { code, mode: written, value: v.value };
    }
    // abs, abx, aby -> use the zero page version when the address fits in one byte
    const zpMode = ({ abs: "zp", abx: "zpx", aby: "zpy" } as const)[written as "abs" | "abx" | "aby"];
    const small = !v.wide && (v.value ?? 0) <= 0xff;
    if (small && modes[zpMode] !== undefined) return { code: modes[zpMode]!, mode: zpMode, value: v.value };
    if (modes[written] !== undefined) return { code: modes[written]!, mode: written, value: v.value };
    if (modes[zpMode] !== undefined && (v.value ?? 0) <= 0xff) return { code: modes[zpMode]!, mode: zpMode, value: v.value };
    throw new AsmError(`?${op} CAN'T USE THIS ADDRESS IN LINE ${line.lineNo}`);
  }

  // Pass 1: addresses of all labels
  let pc = ORIGIN;
  for (const line of lines) {
    if (line.label) {
      if (symbols.has(line.label)) throw new AsmError(`?LABEL ${line.label} USED TWICE (LINE ${line.lineNo})`);
      symbols.set(line.label, pc);
    }
    if (!line.op) continue;
    const c = choose(line, false);
    pc += "data" in c ? c.data.length : SIZE[c.mode];
  }

  // Pass 2: write the bytes
  const bytes = new Map<number, number>();
  const lineAt = new Map<number, number>();
  pc = ORIGIN;
  for (const line of lines) {
    if (!line.op) continue;
    const c = choose(line, true);
    lineAt.set(pc, line.lineNo);
    if ("data" in c) {
      for (const b of c.data) bytes.set(pc++, b);
      continue;
    }
    bytes.set(pc, c.code);
    const v = c.value ?? 0;
    if (c.mode === "rel") {
      const offset = v - (pc + 2);
      if (offset < -128 || offset > 127) throw new AsmError(`?BRANCH TOO FAR IN LINE ${line.lineNo}: USE JMP`);
      bytes.set(pc + 1, offset & 0xff);
    } else if (SIZE[c.mode] === 2) {
      bytes.set(pc + 1, v & 0xff);
    } else if (SIZE[c.mode] === 3) {
      bytes.set(pc + 1, v & 0xff);
      bytes.set(pc + 2, v >> 8);
    }
    pc += SIZE[c.mode];
  }
  const labels = new Map<number, string>();
  for (const [name, value] of symbols) if (!constants.has(name) && !labels.has(value)) labels.set(value, name);
  return { bytes, end: pc, lines: lineAt, labels };
}

// ---------- CPU ----------

// powerOn: start like a real board after switching it on, with leftover bytes in RAM and the registers,
// and the flags all 0 (even number) or all 1 (odd number). Used when checking "order the lines",
// so programs that read memory or the carry too early don't look correct by luck.
// memory: bytes to put into memory before the program starts, like { "0300": 5 } (for quest tests)
// keys: what the "user" types, one character per GETCH
export type AsmOptions = { powerOn?: number; memory?: Record<string, number>; keys?: string };

export function runAsm(source: string, options: AsmOptions = {}): AsmRun {
  return createMachine(source, options).run();
}

// A 6502 that can run a program all at once (run) or one instruction at a time (step)
export type AsmMachine = {
  step: () => AsmRun | null; // null while the program is still running, the result when it has stopped
  run: () => AsmRun;
  state: () => AsmRun; // registers, flags and memory right now
  pc: () => number;
  line: () => number | null; // source line (1-based) of the next instruction
  addressOf: (line: number) => number | null; // where a source line (1-based) was put in memory
  explain: () => string; // what the next instruction will do, in plain words
  result: () => AsmRun | null;
};

export function createMachine(source: string, options: AsmOptions = {}): AsmMachine {
  const { powerOn, memory } = options;
  const keys = [...(options.keys ?? "")];
  const randomMemory = powerOn !== undefined;
  let program: Assembled;
  try {
    program = assemble(source);
  } catch (e) {
    if (!(e instanceof AsmError)) throw e;
    const failed: AsmRun = { output: "", error: e.message, machine: null };
    return {
      step: () => failed, run: () => failed, state: () => failed, pc: () => ORIGIN,
      line: () => null, addressOf: () => null, explain: () => e.message, result: () => failed,
    };
  }

  const mem = new Uint8Array(0x10000);
  if (randomMemory) {
    for (let addr = 0x0000; addr < 0x0100; addr++) mem[addr] = Math.floor(Math.random() * 256);
    for (let addr = 0x0300; addr < 0x0400; addr++) mem[addr] = Math.floor(Math.random() * 256);
  }
  for (const [addr, value] of Object.entries(memory ?? {})) mem[parseInt(addr, 16)] = value & 0xff;
  for (const [addr, b] of program.bytes) mem[addr] = b;
  // The starting values count as "used memory", so the LED panel shows them too
  const written = new Set<number>(Object.keys(memory ?? {}).map((addr) => parseInt(addr, 16)));

  let a = 0, x = 0, y = 0, sp = 0xff, pc = ORIGIN;
  let n = false, v = false, d = false, i = false, z = false, c = false;
  if (randomMemory) {
    // Registers hold leftovers too, and the flags are all 0 (even powerOn) or all 1 (odd powerOn)
    a = Math.floor(Math.random() * 256);
    x = Math.floor(Math.random() * 256);
    y = Math.floor(Math.random() * 256);
    n = z = c = powerOn! % 2 === 1;
  }
  let output = "";
  let steps = 0;

  const read = (addr: number) => mem[addr & 0xffff];
  const write = (addr: number, val: number) => {
    addr &= 0xffff;
    mem[addr] = val & 0xff;
    if (addr < 0x0100 || addr > 0x01ff) written.add(addr);
  };
  const word = (addr: number) => read(addr) | (read(addr + 1) << 8);
  const zpWord = (addr: number) => read(addr & 0xff) | (read((addr + 1) & 0xff) << 8);
  const setNZ = (val: number) => {
    z = (val & 0xff) === 0;
    n = (val & 0x80) !== 0;
    return val & 0xff;
  };
  const push = (val: number) => {
    mem[0x100 + sp] = val & 0xff;
    sp = (sp - 1) & 0xff;
  };
  const pull = () => {
    sp = (sp + 1) & 0xff;
    return mem[0x100 + sp];
  };
  const status = () =>
    (n ? 0x80 : 0) | (v ? 0x40 : 0) | 0x20 | 0x10 | (d ? 0x08 : 0) | (i ? 0x04 : 0) | (z ? 0x02 : 0) | (c ? 0x01 : 0);
  const setStatus = (p: number) => {
    n = !!(p & 0x80); v = !!(p & 0x40); d = !!(p & 0x08); i = !!(p & 0x04); z = !!(p & 0x02); c = !!(p & 0x01);
  };

  function adc(m: number) {
    if (d) {
      let lo = (a & 0x0f) + (m & 0x0f) + (c ? 1 : 0);
      let hi = (a >> 4) + (m >> 4);
      if (lo > 9) (lo -= 10), hi++;
      c = hi > 9;
      if (c) hi -= 10;
      a = setNZ(((hi << 4) | lo) & 0xff);
      return;
    }
    const sum = a + m + (c ? 1 : 0);
    v = (~(a ^ m) & (a ^ sum) & 0x80) !== 0;
    c = sum > 0xff;
    a = setNZ(sum);
  }
  function sbc(m: number) {
    if (d) {
      let lo = (a & 0x0f) - (m & 0x0f) - (c ? 0 : 1);
      let hi = (a >> 4) - (m >> 4);
      if (lo < 0) (lo += 10), hi--;
      c = hi >= 0;
      if (hi < 0) hi += 10;
      a = setNZ(((hi << 4) | lo) & 0xff);
      return;
    }
    const diff = a - m - (c ? 0 : 1);
    v = ((a ^ m) & (a ^ diff) & 0x80) !== 0;
    c = diff >= 0;
    a = setNZ(diff);
  }
  const compare = (reg: number, m: number) => {
    c = reg >= m;
    setNZ(reg - m);
  };

  const finish = (error: string | null): AsmRun => ({
    output,
    error,
    machine: {
      a, x, y, sp,
      flags: { n, v, d, i, z, c },
      mem: Object.fromEntries([...written].sort((p, q) => p - q).map((addr) => [hex(addr, 4), mem[addr]])),
      steps,
    },
  });

  // One instruction. Returns null to keep going, or the result when the program has stopped.
  function stepOnce(): AsmRun | null {
    if (steps++ > MAX_STEPS) {
      return finish("?PROGRAM NEVER STOPPED: CHECK YOUR LOOP, OR END WITH BRK");
    }
    // KIM-1 ROM routine OUTCH: print the character in A, then return
    // KIM-1 ROM routine GETCH: the next key goes into A, then return
    if (pc === GETCH) {
      const key = keys.shift();
      if (key === undefined) return finish("?NO MORE KEYS: THE PROGRAM WAITS FOR MORE INPUT THAN THE TEST TYPES");
      a = setNZ(key.charCodeAt(0));
      if (sp === 0xff) return finish(null);
      const lo = pull();
      pc = ((lo | (pull() << 8)) + 1) & 0xffff;
      return null;
    }
    if (pc === OUTCH) {
      // 13 starts a new line. Other control codes (below $20) print nothing visible.
      if (a === 13) output += "\n";
      else if (a >= 0x20 && a < 0x7f) output += String.fromCharCode(a);
      if (sp === 0xff) return finish(null);
      const lo = pull();
      pc = ((lo | (pull() << 8)) + 1) & 0xffff;
      return null;
    }

    const opPc = pc;
    const opcode = read(pc);
    const decoded = DECODE[opcode];
    if (!decoded) return finish(`?UNKNOWN OPCODE $${hex(opcode)} AT $${hex(opPc, 4)}`);
    const [name, mode] = decoded;

    // Work out the address of the operand
    let addr = 0;
    switch (mode) {
      case "imm": addr = pc + 1; break;
      case "zp": addr = read(pc + 1); break;
      case "zpx": addr = (read(pc + 1) + x) & 0xff; break;
      case "zpy": addr = (read(pc + 1) + y) & 0xff; break;
      case "abs": addr = word(pc + 1); break;
      case "abx": addr = (word(pc + 1) + x) & 0xffff; break;
      case "aby": addr = (word(pc + 1) + y) & 0xffff; break;
      case "ind": {
        const ptr = word(pc + 1); // the real 6502 never crosses a page here
        addr = read(ptr) | (read((ptr & 0xff00) | ((ptr + 1) & 0xff)) << 8);
        break;
      }
      case "izx": addr = zpWord(read(pc + 1) + x); break;
      case "izy": addr = (zpWord(read(pc + 1)) + y) & 0xffff; break;
      case "rel": { const o = read(pc + 1); addr = (pc + 2 + (o < 0x80 ? o : o - 0x100)) & 0xffff; break; }
    }
    pc = (pc + SIZE[mode]) & 0xffff;
    const branch = (cond: boolean) => { if (cond) pc = addr; };
    const modify = (fn: (val: number) => number) => {
      if (mode === "acc") a = fn(a);
      else write(addr, fn(read(addr)));
    };

    switch (name) {
      case "LDA": a = setNZ(read(addr)); break;
      case "LDX": x = setNZ(read(addr)); break;
      case "LDY": y = setNZ(read(addr)); break;
      case "STA": write(addr, a); break;
      case "STX": write(addr, x); break;
      case "STY": write(addr, y); break;
      case "TAX": x = setNZ(a); break;
      case "TAY": y = setNZ(a); break;
      case "TXA": a = setNZ(x); break;
      case "TYA": a = setNZ(y); break;
      case "TSX": x = setNZ(sp); break;
      case "TXS": sp = x; break;
      case "INX": x = setNZ(x + 1); break;
      case "INY": y = setNZ(y + 1); break;
      case "DEX": x = setNZ(x - 1); break;
      case "DEY": y = setNZ(y - 1); break;
      case "INC": write(addr, setNZ(read(addr) + 1)); break;
      case "DEC": write(addr, setNZ(read(addr) - 1)); break;
      case "ADC": adc(read(addr)); break;
      case "SBC": sbc(read(addr)); break;
      case "AND": a = setNZ(a & read(addr)); break;
      case "ORA": a = setNZ(a | read(addr)); break;
      case "EOR": a = setNZ(a ^ read(addr)); break;
      case "CMP": compare(a, read(addr)); break;
      case "CPX": compare(x, read(addr)); break;
      case "CPY": compare(y, read(addr)); break;
      case "BIT": { const m = read(addr); z = (a & m) === 0; n = !!(m & 0x80); v = !!(m & 0x40); break; }
      case "ASL": modify((val) => { c = !!(val & 0x80); return setNZ(val << 1); }); break;
      case "LSR": modify((val) => { c = !!(val & 1); return setNZ(val >> 1); }); break;
      case "ROL": modify((val) => { const r = (val << 1) | (c ? 1 : 0); c = !!(val & 0x80); return setNZ(r); }); break;
      case "ROR": modify((val) => { const r = (val >> 1) | (c ? 0x80 : 0); c = !!(val & 1); return setNZ(r); }); break;
      case "BCC": branch(!c); break;
      case "BCS": branch(c); break;
      case "BEQ": branch(z); break;
      case "BNE": branch(!z); break;
      case "BMI": branch(n); break;
      case "BPL": branch(!n); break;
      case "BVC": branch(!v); break;
      case "BVS": branch(v); break;
      case "JMP": pc = addr; break;
      case "JSR": {
        const ret = (pc - 1) & 0xffff;
        push(ret >> 8);
        push(ret & 0xff);
        pc = addr;
        break;
      }
      case "RTS": {
        if (sp === 0xff) return finish(null); // nothing to return to: the program is done
        const lo = pull();
        pc = ((lo | (pull() << 8)) + 1) & 0xffff;
        break;
      }
      case "RTI": { setStatus(pull()); const lo = pull(); pc = lo | (pull() << 8); break; }
      case "PHA": push(a); break;
      case "PLA": a = setNZ(pull()); break;
      case "PHP": push(status()); break;
      case "PLP": setStatus(pull()); break;
      case "CLC": c = false; break;
      case "SEC": c = true; break;
      case "CLD": d = false; break;
      case "SED": d = true; break;
      case "CLI": i = false; break;
      case "SEI": i = true; break;
      case "CLV": v = false; break;
      case "NOP": break;
      case "BRK": pc = opPc; return finish(null); // the KIM-1 stops and shows the registers
    }
    return null;
  }

  const addressByLine = new Map<number, number>();
  program.lines.forEach((line, addr) => addressByLine.set(line, addr));

  let result: AsmRun | null = null;
  // A JSR into the ROM (OUTCH, GETCH) counts as one step, the ROM routine runs along with it
  const atRom = () => pc === OUTCH || pc === GETCH;
  const stepWithRom = () => {
    let r = stepOnce();
    if (!r && atRom()) r = stepOnce();
    return r;
  };
  const step = () => (result ??= stepWithRom());

  // Step mode: try the next instruction on a copy of the machine, compare, and put everything back
  function explain(): string {
    if (result) return result.error ? result.error : "The program has stopped.";
    const saved = { a, x, y, sp, pc, n, v, d, i, z, c, output, steps, keys: [...keys], written: new Set(written), mem: mem.slice() };
    const opcode = read(pc);
    const decoded = DECODE[opcode];
    const before = { a, x, y, c, z, n, pc };
    const after = stepWithRom();
    const now = { a, x, y, c, z, n, pc };
    const changedMem = [...written].filter((addr) => mem[addr] !== saved.mem[addr] || !saved.written.has(addr));
    const memAfter = changedMem.map((addr) => [addr, mem[addr]] as const);
    const printed = output.slice(saved.output.length);
    // put everything back
    ({ a, x, y, sp, pc, n, v, d, i, z, c, output, steps } = saved);
    keys.splice(0, keys.length, ...saved.keys);
    written.clear();
    saved.written.forEach((w) => written.add(w));
    mem.set(saved.mem);

    if (!decoded) return `$${hex(opcode)} is not an instruction. The 6502 would crash here.`;
    const [name, mode] = decoded;
    const label = (addr: number) => program.labels.get(addr) ?? `$${hex(addr, 4)}`;
    const operand = () => {
      if (mode === "imm") return `$${hex(read(pc + 1))}`;
      return "";
    };
    const effects: string[] = [];
    if (now.a !== before.a) effects.push(`A becomes $${hex(now.a)}`);
    if (now.x !== before.x) effects.push(`X becomes $${hex(now.x)}`);
    if (now.y !== before.y) effects.push(`Y becomes $${hex(now.y)}`);
    for (const [addr, value] of memAfter) effects.push(`$${hex(addr, 4)} becomes $${hex(value)}`);
    if (printed) effects.push(`the teletype prints ${printed === "\n" ? "a new line" : `"${printed}"`}`);
    if (now.c !== before.c) effects.push(`the carry becomes ${now.c ? 1 : 0}`);

    const intro: Record<string, string> = {
      LDA: "Loads a value into A", LDX: "Loads a value into X", LDY: "Loads a value into Y",
      STA: "Stores A in memory", STX: "Stores X in memory", STY: "Stores Y in memory",
      TAX: "Copies A into X", TAY: "Copies A into Y", TXA: "Copies X into A", TYA: "Copies Y into A",
      INX: "Adds 1 to X", INY: "Adds 1 to Y", DEX: "Takes 1 from X", DEY: "Takes 1 from Y",
      INC: "Adds 1 to a byte in memory", DEC: "Takes 1 from a byte in memory",
      ADC: `Adds ${operand() || "a byte"} and the carry (${before.c ? 1 : 0}) to A`,
      SBC: `Subtracts ${operand() || "a byte"} from A, with the carry at ${before.c ? 1 : 0}`,
      CLC: "Clears the carry", SEC: "Sets the carry",
      CMP: `Compares A ($${hex(before.a)}) without changing it`, CPX: `Compares X ($${hex(before.x)})`, CPY: `Compares Y ($${hex(before.y)})`,
      AND: "Keeps only the bits that are also set in the value", ORA: "Sets the bits of the value in A", EOR: "Flips the bits of the value in A",
      ASL: "Shifts left (doubles)", LSR: "Shifts right (halves)", ROL: "Rotates left through the carry", ROR: "Rotates right through the carry",
      PHA: `Puts A ($${hex(before.a)}) on the stack`, PLA: "Takes the top byte of the stack into A",
      NOP: "Does nothing",
    };

    // Jumps and branches explain where the program goes
    if (mode === "rel") {
      const flag = { BEQ: "z", BNE: "z", BCS: "c", BCC: "c", BMI: "n", BPL: "n" }[name as "BEQ"] as "z" | "c" | "n" | undefined;
      const why = flag ? `${flag.toUpperCase()} = ${before[flag] ? 1 : 0}` : "";
      const jumped = now.pc !== (before.pc + 2) % 0x10000;
      const target = (before.pc + 2 + ((read(before.pc + 1) ^ 0x80) - 0x80)) & 0xffff;
      return jumped
        ? `${name}: ${why}, so it jumps to ${label(target)}.`
        : `${name}: ${why}, so it doesn't jump. The program goes on with the next line.`;
    }
    if (name === "JMP") return `JMP always jumps: next stop ${label(now.pc)}.`;
    if (name === "JSR") {
      const target = read(before.pc + 1) | (read(before.pc + 2) << 8);
      if (target === OUTCH) {
        const shown = before.a === 13 ? "a new line" : before.a >= 0x20 && before.a < 0x7f ? `"${String.fromCharCode(before.a)}"` : "an invisible control code";
        return `JSR OUTCH prints the character in A ($${hex(before.a)}): ${shown}.`;
      }
      if (target === GETCH) return after?.error ? after.error : `JSR GETCH waits for a key. The test types "${String.fromCharCode(now.a)}", so A becomes $${hex(now.a)}.`;
      return `JSR calls ${label(target)}. The way back is saved on the stack.`;
    }
    if (name === "RTS") return after ? "RTS with nothing on the stack: the program is finished." : `RTS goes back to the line after the JSR.`;
    if (name === "BRK") return "BRK stops the program. The LEDs show the final registers.";
    if (after?.error) return after.error;
    const loads: Record<string, ["A" | "X" | "Y", number]> = { LDA: ["A", now.a], LDX: ["X", now.x], LDY: ["Y", now.y] };
    if (loads[name]) {
      const [reg, value] = loads[name];
      const from = mode === "imm" ? "" : ` from $${hex((read(before.pc + 1) | (SIZE[mode] === 3 ? read(before.pc + 2) << 8 : 0)), SIZE[mode] === 3 ? 4 : 2)}${mode === "abs" || mode === "zp" ? "" : " (plus the index)"}`;
      return `Loads $${hex(value)}${from} into ${reg}.`;
    }
    const text = intro[name] ?? `Runs ${name}`;
    return effects.length ? `${text}: ${effects.join(", ")}.` : `${text}. Nothing visible changes.`;
  }

  return {
    step,
    run: () => {
      while (!result) step();
      return result;
    },
    state: () => result ?? finish(null),
    pc: () => pc,
    line: () => program.lines.get(pc) ?? null,
    addressOf: (line) => addressByLine.get(line) ?? null,
    explain,
    result: () => result,
  };
}

// "$0A" style, used for messages and the LED display
export const toHex = hex;

// ---------- Checking quests ----------

// What a quest wants to see when the program stops. Values are plain numbers (0-255).
export type MachineExpect = {
  a?: number;
  x?: number;
  y?: number;
  c?: boolean; // carry flag
  mem?: Record<string, number>; // address (4 hex digits) -> value
};

// Everything that doesn't match yet, in plain words. Empty = all good.
export function expectProblems(machine: MachineState | null | undefined, expect: MachineExpect): string[] {
  if (!machine) return ["The program didn't run."];
  const problems: string[] = [];
  const regs = [["A", machine.a, expect.a], ["X", machine.x, expect.x], ["Y", machine.y, expect.y]] as const;
  for (const [name, actual, wanted] of regs) {
    if (wanted !== undefined && actual !== wanted) problems.push(`${name} is $${hex(actual)}, but it should be $${hex(wanted)}.`);
  }
  if (expect.c !== undefined && machine.flags.c !== expect.c) {
    problems.push(`The carry flag is ${machine.flags.c ? "set (1)" : "clear (0)"}, but it should be ${expect.c ? "set (1)" : "clear (0)"}.`);
  }
  for (const [addr, wanted] of Object.entries(expect.mem ?? {})) {
    const actual = machine.mem[addr.toUpperCase()];
    // Memory starts at $00, so an address that was never written still counts as $00
    if (actual === undefined && wanted === 0) continue;
    if (actual === undefined) problems.push(`Nothing was stored at $${addr.toUpperCase()}. It should hold $${hex(wanted)}.`);
    else if (actual !== wanted) problems.push(`$${addr.toUpperCase()} holds $${hex(actual)}, but it should hold $${hex(wanted)}.`);
  }
  return problems;
}

// One test of a quest: memory to start with, and what the program must end with
// output: what the teletype must print in this test (if it differs from test to test)
// keys: what is typed on the teletype during this test (read with GETCH)
export type QuestCase = { memory?: Record<string, number>; expect: MachineExpect; output?: string; keys?: string };

// "$0300 = $05, $0301 = $03"
export function describeMemory(memory: Record<string, number> | undefined): string {
  return Object.entries(memory ?? {})
    .map(([addr, v]) => `$${addr.toUpperCase()} = $${hex(v)}`)
    .join(", ");
}

// The expected result as short lines, e.g. ["A = $0A", "$0300 = $07"]
export function describeExpect(expect: MachineExpect): string[] {
  const lines: string[] = [];
  const regs = [["A", expect.a], ["X", expect.x], ["Y", expect.y]] as const;
  const regLine = regs.filter(([, v]) => v !== undefined).map(([n, v]) => `${n} = $${hex(v!)}`).join("   ");
  if (regLine) lines.push(regLine);
  if (expect.c !== undefined) lines.push(`CARRY = ${expect.c ? 1 : 0}`);
  for (const [addr, v] of Object.entries(expect.mem ?? {})) lines.push(`$${addr.toUpperCase()} = $${hex(v)}`);
  return lines;
}
