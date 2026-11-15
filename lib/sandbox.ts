import AsyncStorage from "@react-native-async-storage/async-storage";

// Programs written in the sandbox, saved on the phone, one list per course
export type SandboxProgram = { id: string; name: string; code: string; input: string; updated: string };

const key = (courseId: string) => `basic-lingo-sandbox-${courseId}`;

export async function loadPrograms(courseId: string): Promise<SandboxProgram[]> {
  try {
    const raw = await AsyncStorage.getItem(key(courseId));
    return raw ? (JSON.parse(raw) as SandboxProgram[]) : [];
  } catch {
    return [];
  }
}

export async function savePrograms(courseId: string, programs: SandboxProgram[], fromCloud = false) {
  try {
    // Remember deleted programs, so another device doesn't bring them back
    if (!fromCloud) {
      const before = await loadPrograms(courseId);
      const gone = before.filter((p) => !programs.some((q) => q.id === p.id)).map((p) => p.id);
      if (gone.length) await addDeleted(gone);
    }
    await AsyncStorage.setItem(key(courseId), JSON.stringify(programs));
    if (!fromCloud) changed();
  } catch {
    // Saving is best effort: the program stays on screen either way
  }
}

// ---------- For the cloud save ----------

const DELETED_KEY = "basic-lingo-sandbox-deleted";

export async function loadDeleted(): Promise<string[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(DELETED_KEY)) ?? "[]");
  } catch {
    return [];
  }
}

export async function addDeleted(ids: string[]) {
  const list = await loadDeleted();
  const next = [...new Set([...list, ...ids])].slice(-2000);
  await AsyncStorage.setItem(DELETED_KEY, JSON.stringify(next));
}

const listeners = new Set<() => void>();
export function onProgramsSaved(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function changed() {
  listeners.forEach((l) => l());
}

// A first program, so the sandbox never starts completely empty
export const STARTERS: Record<string, { name: string; code: string; input: string }> = {
  basic: {
    name: "HELLO",
    code: '10 REM MY FIRST PROGRAM\n20 PRINT "HELLO, WORLD"\n30 FOR I = 1 TO 3\n40 PRINT I\n50 NEXT I\n60 END\n',
    input: "",
  },
  fortran: {
    name: "HELLO",
    code: "C     MY FIRST DECK\n      WRITE (6,10)\n   10 FORMAT (' HELLO, WORLD')\n      DO 20 I = 1, 3\n      WRITE (6,30) I\n   20 CONTINUE\n   30 FORMAT (1X, I3)\n      STOP\n      END\n",
    input: "",
  },
  c: {
    name: "hello",
    code: '#include <stdio.h>\n\n/* my first program */\nint main() {\n    int i;\n    printf("hello, world\\n");\n    for (i = 1; i <= 3; i++)\n        printf("%d\\n", i);\n    return 0;\n}\n',
    input: "",
  },
  cobol: {
    name: "HELLO",
    code: '      * MY FIRST JOB\n       IDENTIFICATION DIVISION.\n       PROGRAM-ID. HELLO.\n       DATA DIVISION.\n       WORKING-STORAGE SECTION.\n       01 I          PIC 9 VALUE 1.\n       PROCEDURE DIVISION.\n           DISPLAY "HELLO, WORLD".\n           PERFORM 3 TIMES\n               DISPLAY I\n               ADD 1 TO I\n           END-PERFORM.\n           STOP RUN.\n',
    input: "",
  },
  altair: {
    name: "LIGHTS",
    code: "; MY FIRST PROGRAM\n00 111 110   ; MVI A\n10 101 010   ; the pattern\n11 010 011   ; OUT\n11 111 111   ; port 377: the lights\n01 110 110   ; HLT\n",
    input: "",
  },
  pascal: {
    name: "Hello",
    code: "program Hello;\n{ my first program }\nvar\n  i: integer;\nbegin\n  writeln('Hello, world!');\n  for i := 1 to 3 do\n    writeln(i);\nend.\n",
    input: "",
  },
  "6502": {
    name: "HELLO",
    code: '; MY FIRST PROGRAM\nOUTCH = $1EA0\nLDX #0\nLOOP: LDA MSG,X\nBEQ DONE\nJSR OUTCH\nINX\nJMP LOOP\nDONE: BRK\nMSG: .BYTE "HELLO, WORLD", 0\n',
    input: "",
  },
};

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
