// The MITS Altair 8800 (1975) with its Intel 8080 processor and 256 bytes of memory.
// Programs are written the way they were toggled in on the front panel: one byte per line,
// as 8 binary digits (spaces allowed: 00 111 110) or as 3 octal digits (076).
// Everything after a ; is a comment. The program is loaded at address 0 and runs until HLT.
//
// Input and output, as the lessons use them:
//   OUT 377 (255) shows the A register on the front panel lights: "LEDS ○○○○○●○● = 5"
//   OUT 001 (1)   sends A to the Teletype as a character
//   IN  377 (255) reads the front-panel sense switches (in quests, the values come from the test)
import type { RunResult } from "./course";

const MEMORY = 256;
const MAX_STEPS = 200_000;
const MAX_OUTPUT = 20_000;

export const OPCODE_NAMES: Record<number, string> = {};

class AltairError extends Error {}

export type AltairState = { a: number; b: number; c: number; d: number; e: number; h: number; l: number; pc: number; sp: number; flags: { s: boolean; z: boolean; p: boolean; cy: boolean } };

// ----- Loading the program -----

export function parseProgram(source: string): { bytes: number[]; lines: number[] } {
  const bytes: number[] = [];
  const lines: number[] = []; // which source line each byte came from
  source.split(/\r?\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    const text = raw.replace(/;.*$/, "").trim();
    if (text === "") return;
    const compact = text.replace(/\s+/g, "");
    let value: number;
    if (/^[01]+$/.test(compact) && compact.length !== 3) {
      if (compact.length !== 8)
        throw new AltairError(`Line ${lineNo}: ${text} has ${compact.length} bit${compact.length === 1 ? "" : "s"}. Every byte needs exactly 8 switches (or 3 octal digits).`);
      value = parseInt(compact, 2);
    } else if (/^[0-7]{3}$/.test(compact)) {
      value = parseInt(compact, 8);
      if (value > 255) throw new AltairError(`Line ${lineNo}: ${text} is too big for one byte. Octal bytes go from 000 to 377.`);
    } else if (/^[01]{3}$/.test(compact)) {
      value = parseInt(compact, 8);
    } else {
      throw new AltairError(`Line ${lineNo}: ${text} isn't a byte. Write 8 binary digits like 00111110, or 3 octal digits like 076.`);
    }
    bytes.push(value);
    lines.push(lineNo);
  });
  if (bytes.length > MEMORY) throw new AltairError(`The program has ${bytes.length} bytes, but the Altair only has ${MEMORY} bytes of memory.`);
  return { bytes, lines };
}

export const bin8 = (n: number) => (n & 255).toString(2).padStart(8, "0");
export const oct3 = (n: number) => (n & 255).toString(8).padStart(3, "0");
export const leds = (n: number) => bin8(n).replace(/1/g, "●").replace(/0/g, "○");

// ----- The 8080 -----

const REG_NAMES = ["B", "C", "D", "E", "H", "L", "M", "A"];

function parity(n: number) {
  let p = 0;
  for (let i = 0; i < 8; i++) p ^= (n >> i) & 1;
  return p === 0; // P flag is set for an even number of 1 bits
}

// The processor. runAltair() uses it for a whole program at once;
// the sandbox front panel (altair-panel.tsx) steps it a few thousand instructions at a time.
export class CPU {
  r = [0, 0, 0, 0, 0, 0, 0, 0]; // B C D E H L (M) A
  pc = 0;
  sp = 0x100; // the stack grows down from the end of the 256 bytes
  s = false;
  z = false;
  p = false;
  cy = false;
  ac = false;
  mem = new Uint8Array(MEMORY);
  halted = false;
  steps = 0;
  output = "";
  inPos = 0;
  lastIn = 0;
  opAddr = 0;
  maxSteps = MAX_STEPS;
  // Front panel mode: IN 377 reads the live sense switches, OUT 377 sets the output lights
  // instead of printing, and the Teletype keeps only its last lines.
  sense: (() => number) | null = null;
  port377 = 0;
  lastIO: "in" | "out" | null = null;

  constructor(
    private inputs: number[],
    private lines: number[]
  ) {}

  where() {
    const line = this.lines[this.opAddr];
    return `address ${this.opAddr.toString(8).padStart(3, "0")} (${this.opAddr})${line ? `, line ${line}` : ""}`;
  }

  read(addr: number): number {
    addr &= 0xffff;
    if (addr >= MEMORY)
      throw new AltairError(`The program read address ${addr} at ${this.where()}, but the Altair only has ${MEMORY} bytes of memory (0 to 255).`);
    return this.mem[addr];
  }
  write(addr: number, v: number) {
    addr &= 0xffff;
    if (addr >= MEMORY)
      throw new AltairError(`The program wrote to address ${addr} at ${this.where()}, but the Altair only has ${MEMORY} bytes of memory (0 to 255).`);
    this.mem[addr] = v & 255;
  }
  fetch(): number {
    const v = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }
  fetch16(): number {
    const lo = this.fetch();
    return lo | (this.fetch() << 8);
  }

  get hl() {
    return (this.r[4] << 8) | this.r[5];
  }
  set hl(v: number) {
    this.r[4] = (v >> 8) & 255;
    this.r[5] = v & 255;
  }
  getReg(i: number) {
    return i === 6 ? this.read(this.hl) : this.r[i];
  }
  setReg(i: number, v: number) {
    if (i === 6) this.write(this.hl, v);
    else this.r[i] = v & 255;
  }
  getPair(rp: number): number {
    if (rp === 3) return this.sp;
    return (this.r[rp * 2] << 8) | this.r[rp * 2 + 1];
  }
  setPair(rp: number, v: number) {
    v &= 0xffff;
    if (rp === 3) this.sp = v;
    else {
      this.r[rp * 2] = v >> 8;
      this.r[rp * 2 + 1] = v & 255;
    }
  }
  setSZP(v: number) {
    this.s = (v & 0x80) !== 0;
    this.z = (v & 255) === 0;
    this.p = parity(v & 255);
  }
  flagsByte() {
    return (this.s ? 0x80 : 0) | (this.z ? 0x40 : 0) | (this.ac ? 0x10 : 0) | (this.p ? 0x04 : 0) | 0x02 | (this.cy ? 0x01 : 0);
  }
  setFlagsByte(f: number) {
    this.s = (f & 0x80) !== 0;
    this.z = (f & 0x40) !== 0;
    this.ac = (f & 0x10) !== 0;
    this.p = (f & 0x04) !== 0;
    this.cy = (f & 0x01) !== 0;
  }
  push(v: number) {
    this.sp = (this.sp - 1) & 0xffff;
    this.write(this.sp, v >> 8);
    this.sp = (this.sp - 1) & 0xffff;
    this.write(this.sp, v & 255);
  }
  pop(): number {
    const lo = this.read(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    const hi = this.read(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    return lo | (hi << 8);
  }
  cond(c: number): boolean {
    switch (c) {
      case 0:
        return !this.z;
      case 1:
        return this.z;
      case 2:
        return !this.cy;
      case 3:
        return this.cy;
      case 4:
        return !this.p;
      case 5:
        return this.p;
      case 6:
        return !this.s;
      default:
        return this.s;
    }
  }

  // ADD ADC SUB SBB ANA XRA ORA CMP
  alu(op: number, v: number) {
    const a = this.r[7];
    switch (op) {
      case 0:
      case 1: {
        const c = op === 1 && this.cy ? 1 : 0;
        const res = a + v + c;
        this.ac = ((a & 15) + (v & 15) + c) > 15;
        this.cy = res > 255;
        this.r[7] = res & 255;
        this.setSZP(res);
        return;
      }
      case 2:
      case 3:
      case 7: {
        const c = op === 3 && this.cy ? 1 : 0;
        const res = a - v - c;
        this.ac = (a & 15) - (v & 15) - c >= 0;
        this.cy = res < 0; // borrow
        this.setSZP(res & 255);
        if (op !== 7) this.r[7] = res & 255;
        return;
      }
      case 4:
        this.ac = ((a | v) & 0x08) !== 0;
        this.r[7] = a & v;
        this.cy = false;
        this.setSZP(this.r[7]);
        return;
      case 5:
        this.r[7] = a ^ v;
        this.cy = false;
        this.ac = false;
        this.setSZP(this.r[7]);
        return;
      default:
        this.r[7] = a | v;
        this.cy = false;
        this.ac = false;
        this.setSZP(this.r[7]);
    }
  }

  io(op: number, port: number) {
    if (op === 0xd3) {
      // OUT
      const a = this.r[7];
      this.lastIO = "out";
      if (port === 255 && this.sense) this.port377 = a;
      else if (port === 255) this.out(`LEDS ${leds(a)} = ${a}\n`);
      else if (port === 1) this.out(String.fromCharCode(a & 127));
      else throw new AltairError(`OUT ${oct3(port)} at ${this.where()}: nothing is connected to port ${port}. Use port 377 (the lights) or 001 (the Teletype).`);
    } else {
      // IN
      this.lastIO = "in";
      if (port === 255 && this.sense) this.r[7] = this.sense() & 255;
      else if (port === 255) {
        if (this.inPos < this.inputs.length) this.lastIn = this.inputs[this.inPos++] & 255;
        this.r[7] = this.lastIn;
      } else throw new AltairError(`IN ${oct3(port)} at ${this.where()}: nothing is connected to port ${port}. Port 377 reads the sense switches.`);
    }
  }
  out(s: string) {
    this.output += s;
    if (this.sense) {
      if (this.output.length > 4000) this.output = this.output.slice(-2000);
      return;
    }
    if (this.output.length > MAX_OUTPUT) throw new AltairError("Output limit exceeded: the program printed too much. Is there a loop without an end?");
  }

  step() {
    if (++this.steps > this.maxSteps) throw new AltairError("The program never reached HLT. Is there a loop that never ends, or did the program run into empty memory?");
    this.opAddr = this.pc;
    if (this.pc >= MEMORY)
      throw new AltairError("The program ran off the end of memory without reaching HLT. Did you forget 01 110 110 (HLT) at the end?");
    const op = this.fetch();
    const hi = op >> 6;
    const ddd = (op >> 3) & 7;
    const sss = op & 7;
    if (hi === 1) {
      if (op === 0x76) {
        this.halted = true;
        return;
      }
      this.setReg(ddd, this.getReg(sss)); // MOV
      return;
    }
    if (hi === 2) {
      this.alu(ddd, this.getReg(sss));
      return;
    }
    if (hi === 0) {
      switch (sss) {
        case 0:
          if (ddd === 0) return; // NOP
          break;
        case 1:
          if (ddd & 1) {
            // DAD
            const res = this.hl + this.getPair(ddd >> 1);
            this.cy = res > 0xffff;
            this.hl = res & 0xffff;
          } else this.setPair(ddd >> 1, this.fetch16()); // LXI
          return;
        case 2:
          switch (ddd) {
            case 0:
              this.write(this.getPair(0), this.r[7]);
              return; // STAX B
            case 1:
              this.r[7] = this.read(this.getPair(0));
              return; // LDAX B
            case 2:
              this.write(this.getPair(1), this.r[7]);
              return; // STAX D
            case 3:
              this.r[7] = this.read(this.getPair(1));
              return; // LDAX D
            case 4: {
              const a = this.fetch16(); // SHLD
              this.write(a, this.r[5]);
              this.write(a + 1, this.r[4]);
              return;
            }
            case 5: {
              const a = this.fetch16(); // LHLD
              this.r[5] = this.read(a);
              this.r[4] = this.read(a + 1);
              return;
            }
            case 6:
              this.write(this.fetch16(), this.r[7]);
              return; // STA
            default:
              this.r[7] = this.read(this.fetch16());
              return; // LDA
          }
        case 3:
          this.setPair(ddd >> 1, this.getPair(ddd >> 1) + (ddd & 1 ? -1 : 1)); // INX / DCX
          return;
        case 4: {
          const v = (this.getReg(ddd) + 1) & 255; // INR
          this.ac = (v & 15) === 0;
          this.setReg(ddd, v);
          this.setSZP(v);
          return;
        }
        case 5: {
          const v = (this.getReg(ddd) - 1) & 255; // DCR
          this.ac = (v & 15) !== 15;
          this.setReg(ddd, v);
          this.setSZP(v);
          return;
        }
        case 6:
          this.setReg(ddd, this.fetch()); // MVI
          return;
        case 7: {
          const a = this.r[7];
          switch (ddd) {
            case 0:
              this.cy = (a & 0x80) !== 0;
              this.r[7] = ((a << 1) | (this.cy ? 1 : 0)) & 255;
              return; // RLC
            case 1:
              this.cy = (a & 1) !== 0;
              this.r[7] = ((a >> 1) | (this.cy ? 0x80 : 0)) & 255;
              return; // RRC
            case 2: {
              const c = this.cy ? 1 : 0; // RAL
              this.cy = (a & 0x80) !== 0;
              this.r[7] = ((a << 1) | c) & 255;
              return;
            }
            case 3: {
              const c = this.cy ? 0x80 : 0; // RAR
              this.cy = (a & 1) !== 0;
              this.r[7] = (a >> 1) | c;
              return;
            }
            case 4: {
              // DAA
              let v = a;
              let carry = this.cy;
              if ((v & 15) > 9 || this.ac) v += 6;
              if ((v >> 4) > 9 || carry || v > 0xff) {
                v += 0x60;
                carry = true;
              }
              this.ac = (a & 15) + 6 > 15;
              this.cy = carry;
              this.r[7] = v & 255;
              this.setSZP(this.r[7]);
              return;
            }
            case 5:
              this.r[7] = ~a & 255;
              return; // CMA
            case 6:
              this.cy = true;
              return; // STC
            default:
              this.cy = !this.cy;
              return; // CMC
          }
        }
      }
    } else {
      // hi === 3
      switch (sss) {
        case 0:
          if (this.cond(ddd)) this.pc = this.pop(); // Rcc
          return;
        case 1:
          if (ddd & 1) {
            if (ddd === 1) this.pc = this.pop(); // RET
            else if (ddd === 5) this.pc = this.hl; // PCHL
            else if (ddd === 7) this.sp = this.hl; // SPHL
            else break;
          } else {
            const v = this.pop(); // POP
            if (ddd >> 1 === 3) {
              this.setFlagsByte(v & 255);
              this.r[7] = v >> 8;
            } else this.setPair(ddd >> 1, v);
          }
          return;
        case 2: {
          const a = this.fetch16(); // Jcc
          if (this.cond(ddd)) this.pc = a;
          return;
        }
        case 3:
          switch (ddd) {
            case 0:
              this.pc = this.fetch16(); // JMP
              return;
            case 2:
            case 3:
              this.io(op, this.fetch());
              return;
            case 4: {
              const lo = this.read(this.sp); // XTHL
              const h = this.read(this.sp + 1);
              this.write(this.sp, this.r[5]);
              this.write(this.sp + 1, this.r[4]);
              this.r[5] = lo;
              this.r[4] = h;
              return;
            }
            case 5: {
              const de = this.getPair(1); // XCHG
              this.setPair(1, this.hl);
              this.hl = de;
              return;
            }
            case 6:
            case 7:
              return; // DI, EI
          }
          break;
        case 4: {
          const a = this.fetch16(); // Ccc
          if (this.cond(ddd)) {
            this.push(this.pc);
            this.pc = a;
          }
          return;
        }
        case 5:
          if (ddd & 1) {
            if (ddd === 1) {
              const a = this.fetch16(); // CALL
              this.push(this.pc);
              this.pc = a;
              return;
            }
            break;
          }
          if (ddd >> 1 === 3) this.push((this.r[7] << 8) | this.flagsByte()); // PUSH PSW
          else this.push(this.getPair(ddd >> 1)); // PUSH
          return;
        case 6:
          this.alu(ddd, this.fetch()); // ADI … CPI
          return;
        default:
          this.push(this.pc); // RST
          this.pc = ddd * 8;
          return;
      }
    }
    throw new AltairError(`${bin8(op)} at ${this.where()} isn't an 8080 instruction.`);
  }

  state(): AltairState {
    return {
      a: this.r[7],
      b: this.r[0],
      c: this.r[1],
      d: this.r[2],
      e: this.r[3],
      h: this.r[4],
      l: this.r[5],
      pc: this.pc,
      sp: this.sp,
      flags: { s: this.s, z: this.z, p: this.p, cy: this.cy },
    };
  }
}

// inputs: the values on the sense switches, one per IN 377 (numbers, or binary strings like "00010101")
export function runAltair(source: string, inputs: (number | string)[] = []): RunResult & { altair?: AltairState | null } {
  let cpu: CPU | null = null;
  try {
    const { bytes, lines } = parseProgram(source);
    if (bytes.length === 0) return { output: "", error: "The program is empty. Toggle in at least one byte, like 01110110 (HLT)." };
    const values = inputs.map((v) => (typeof v === "number" ? v : /^[01\s]{8,}$/.test(String(v).trim()) ? parseInt(String(v).replace(/\s/g, ""), 2) : Number(v)));
    cpu = new CPU(values.map((v) => (Number.isFinite(v) ? v : 0)), lines);
    bytes.forEach((b, i) => (cpu!.mem[i] = b));
    while (!cpu.halted) cpu.step();
    return { output: cpu.output, error: null, altair: cpu.state() };
  } catch (e) {
    if (e instanceof AltairError) return { output: cpu?.output ?? "", error: e.message, altair: cpu?.state() ?? null };
    return { output: cpu?.output ?? "", error: "Something went wrong running the program." };
  }
}

// Short names for the reference, explanations and the front panel, like "MVI A" for 00 111 110
const PAIRS = ["B", "D", "H", "SP"];
const CONDS = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"];
export function mnemonic(op: number): string {
  const hi = op >> 6;
  const ddd = (op >> 3) & 7;
  const sss = op & 7;
  if (op === 0x76) return "HLT";
  if (hi === 1) return `MOV ${REG_NAMES[ddd]},${REG_NAMES[sss]}`;
  if (hi === 2) return `${["ADD", "ADC", "SUB", "SBB", "ANA", "XRA", "ORA", "CMP"][ddd]} ${REG_NAMES[sss]}`;
  if (hi === 0) {
    if (sss === 6) return `MVI ${REG_NAMES[ddd]}`;
    if (sss === 4) return `INR ${REG_NAMES[ddd]}`;
    if (sss === 5) return `DCR ${REG_NAMES[ddd]}`;
    if (op === 0) return "NOP";
    if (sss === 1) return ddd & 1 ? `DAD ${PAIRS[ddd >> 1]}` : `LXI ${PAIRS[ddd >> 1]}`;
    if (sss === 3) return `${ddd & 1 ? "DCX" : "INX"} ${PAIRS[ddd >> 1]}`;
    if (sss === 2) return ["STAX B", "LDAX B", "STAX D", "LDAX D", "SHLD", "LHLD", "STA", "LDA"][ddd];
    if (sss === 7) return ["RLC", "RRC", "RAL", "RAR", "DAA", "CMA", "STC", "CMC"][ddd];
    return "?";
  }
  if (op === 0xc3) return "JMP";
  if (op === 0xd3) return "OUT";
  if (op === 0xdb) return "IN";
  if (op === 0xcd) return "CALL";
  if (op === 0xc9) return "RET";
  if (op === 0xe9) return "PCHL";
  if (op === 0xf9) return "SPHL";
  if (op === 0xe3) return "XTHL";
  if (op === 0xeb) return "XCHG";
  if (op === 0xf3) return "DI";
  if (op === 0xfb) return "EI";
  if (sss === 0) return `R${CONDS[ddd]}`;
  if (sss === 2) return `J${CONDS[ddd]}`;
  if (sss === 4) return `C${CONDS[ddd]}`;
  if (sss === 1 && !(ddd & 1)) return `POP ${ddd >> 1 === 3 ? "PSW" : PAIRS[ddd >> 1]}`;
  if (sss === 5 && !(ddd & 1)) return `PUSH ${ddd >> 1 === 3 ? "PSW" : PAIRS[ddd >> 1]}`;
  if (sss === 6) return ["ADI", "ACI", "SUI", "SBI", "ANI", "XRI", "ORI", "CPI"][ddd];
  if (sss === 7) return `RST ${ddd}`;
  return "?";
}

// How many bytes an instruction takes: the opcode plus 0, 1 or 2 bytes after it
export function instructionLength(op: number): number {
  const hi = op >> 6;
  const ddd = (op >> 3) & 7;
  const sss = op & 7;
  if (hi === 0) {
    if (sss === 6) return 2; // MVI
    if (sss === 1 && !(ddd & 1)) return 3; // LXI
    if (sss === 2 && ddd >= 4) return 3; // SHLD LHLD STA LDA
    return 1;
  }
  if (hi === 3) {
    if (sss === 2 || sss === 4) return 3; // Jcc Ccc
    if (op === 0xc3 || op === 0xcd) return 3; // JMP CALL
    if (op === 0xd3 || op === 0xdb) return 2; // OUT IN
    if (sss === 6) return 2; // ADI … CPI
  }
  return 1;
}

// Memory back to program lines, the way the course writes them: 076   ; 000: MVI A
export function listing(mem: ArrayLike<number>, length: number): string {
  const out: string[] = [];
  let addr = 0;
  while (addr < length) {
    const op = mem[addr];
    const size = instructionLength(op);
    out.push(`${oct3(op)}   ; ${oct3(addr)}: ${mnemonic(op)}`);
    const name = mnemonic(op);
    for (let k = 1; k < size && addr + k < length; k++) {
      const v = mem[addr + k];
      const note =
        name === "OUT" || name === "IN"
          ? v === 255 ? (name === "IN" ? "port 377 (the sense switches)" : "port 377 (the lights)") : v === 1 ? "port 001 (the Teletype)" : `port ${oct3(v)}`
          : size === 3
            ? k === 1 ? `address ${oct3(v)} (${v})` : "(high byte)"
            : `${v}`;
      out.push(`${oct3(v)}   ; ${oct3(addr + k)}: ${note}`);
    }
    addr += size;
  }
  return out.join("\n") + "\n";
}
