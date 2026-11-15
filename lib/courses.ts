import basicChapters from "../src/app/data/chapters.json";
import basicQuests from "../src/app/data/quests.json";
import unit1File from "../src/app/data/unit1.json";
import unit2File from "../src/app/data/unit2.json";
import unit3File from "../src/app/data/unit3.json";
import unit4File from "../src/app/data/unit4.json";
import unit5File from "../src/app/data/unit5.json";
import unit6File from "../src/app/data/unit6.json";
import unit7File from "../src/app/data/unit7.json";
import unit8File from "../src/app/data/unit8.json";
import unit9File from "../src/app/data/unit9.json";
import unit10File from "../src/app/data/unit10.json";
import unit11File from "../src/app/data/unit11.json";
import unit12File from "../src/app/data/unit12.json";
import unit13File from "../src/app/data/unit13.json";
import unit14File from "../src/app/data/unit14.json";
import unit15File from "../src/app/data/unit15.json";
import asmChapters from "../src/app/data/6502/chapters.json";
import asmQuests from "../src/app/data/6502/quests.json";
import asmUnit1 from "../src/app/data/6502/a1.json";
import asmUnit2 from "../src/app/data/6502/a2.json";
import asmUnit3 from "../src/app/data/6502/a3.json";
import asmUnit4 from "../src/app/data/6502/a4.json";
import asmUnit5 from "../src/app/data/6502/a5.json";
import asmUnit6 from "../src/app/data/6502/a6.json";
import asmUnit7 from "../src/app/data/6502/a7.json";
import asmUnit8 from "../src/app/data/6502/a8.json";
import asmUnit9 from "../src/app/data/6502/a9.json";
import asmUnit10 from "../src/app/data/6502/a10.json";
import asmUnit11 from "../src/app/data/6502/a11.json";
import asmUnit12 from "../src/app/data/6502/a12.json";
import asmUnit13 from "../src/app/data/6502/a13.json";
import asmUnit14 from "../src/app/data/6502/a14.json";
import asmUnit15 from "../src/app/data/6502/a15.json";
import fortranChapters from "../src/app/data/fortran/chapters.json";
import fortranQuests from "../src/app/data/fortran/quests.json";
import fortranUnit1 from "../src/app/data/fortran/f1.json";
import fortranUnit2 from "../src/app/data/fortran/f2.json";
import fortranUnit3 from "../src/app/data/fortran/f3.json";
import fortranUnit4 from "../src/app/data/fortran/f4.json";
import fortranUnit5 from "../src/app/data/fortran/f5.json";
import fortranUnit6 from "../src/app/data/fortran/f6.json";
import fortranUnit7 from "../src/app/data/fortran/f7.json";
import fortranUnit8 from "../src/app/data/fortran/f8.json";
import fortranUnit9 from "../src/app/data/fortran/f9.json";
import fortranUnit10 from "../src/app/data/fortran/f10.json";
import fortranUnit11 from "../src/app/data/fortran/f11.json";
import fortranUnit12 from "../src/app/data/fortran/f12.json";
import fortranUnit13 from "../src/app/data/fortran/f13.json";
import fortranUnit14 from "../src/app/data/fortran/f14.json";
import fortranUnit15 from "../src/app/data/fortran/f15.json";
import fortranUnit16 from "../src/app/data/fortran/f16.json";
import fortranUnit17 from "../src/app/data/fortran/f17.json";
import fortranUnit18 from "../src/app/data/fortran/f18.json";
import { altairTheme, basicTheme, cobolTheme, ibmTheme, kimTheme, turboTheme, unixTheme } from "../theme";
import { runFortran } from "./fortran";
import { runC } from "./c";
import cChapters from "../src/app/data/c/chapters.json";
import cQuests from "../src/app/data/c/quests.json";
import cUnit1 from "../src/app/data/c/c1.json";
import cUnit2 from "../src/app/data/c/c2.json";
import cUnit3 from "../src/app/data/c/c3.json";
import cUnit4 from "../src/app/data/c/c4.json";
import cUnit5 from "../src/app/data/c/c5.json";
import cUnit6 from "../src/app/data/c/c6.json";
import cUnit7 from "../src/app/data/c/c7.json";
import cUnit8 from "../src/app/data/c/c8.json";
import cUnit9 from "../src/app/data/c/c9.json";
import cUnit10 from "../src/app/data/c/c10.json";
import cUnit11 from "../src/app/data/c/c11.json";
import cUnit12 from "../src/app/data/c/c12.json";
import cUnit13 from "../src/app/data/c/c13.json";
import cUnit14 from "../src/app/data/c/c14.json";
import cUnit15 from "../src/app/data/c/c15.json";
import cUnit16 from "../src/app/data/c/c16.json";
import cUnit17 from "../src/app/data/c/c17.json";
import cUnit18 from "../src/app/data/c/c18.json";
import cUnit19 from "../src/app/data/c/c19.json";
import cUnit20 from "../src/app/data/c/c20.json";
import cUnit21 from "../src/app/data/c/c21.json";
import cUnit22 from "../src/app/data/c/c22.json";
import cUnit23 from "../src/app/data/c/c23.json";
import cUnit24 from "../src/app/data/c/c24.json";
import cUnit25 from "../src/app/data/c/c25.json";
import cUnit26 from "../src/app/data/c/c26.json";
import cUnit27 from "../src/app/data/c/c27.json";
import { runAsm } from "./asm6502";
import { runBasic } from "./basic";
import { ChapterJson, Course, LessonData, QuestData, buildCourse } from "./course";
import pascalChapters from "../src/app/data/pascal/chapters.json";
import pascalQuests from "../src/app/data/pascal/quests.json";
import pascalUnit1 from "../src/app/data/pascal/p1.json";
import pascalUnit2 from "../src/app/data/pascal/p2.json";
import pascalUnit3 from "../src/app/data/pascal/p3.json";
import pascalUnit4 from "../src/app/data/pascal/p4.json";
import pascalUnit5 from "../src/app/data/pascal/p5.json";
import pascalUnit6 from "../src/app/data/pascal/p6.json";
import pascalUnit7 from "../src/app/data/pascal/p7.json";
import pascalUnit8 from "../src/app/data/pascal/p8.json";
import pascalUnit9 from "../src/app/data/pascal/p9.json";
import pascalUnit10 from "../src/app/data/pascal/p10.json";
import pascalUnit11 from "../src/app/data/pascal/p11.json";
import pascalUnit12 from "../src/app/data/pascal/p12.json";
import pascalUnit13 from "../src/app/data/pascal/p13.json";
import pascalUnit14 from "../src/app/data/pascal/p14.json";
import pascalUnit15 from "../src/app/data/pascal/p15.json";
import pascalUnit16 from "../src/app/data/pascal/p16.json";
import pascalUnit17 from "../src/app/data/pascal/p17.json";
import pascalUnit18 from "../src/app/data/pascal/p18.json";
import pascalUnit19 from "../src/app/data/pascal/p19.json";
import pascalUnit20 from "../src/app/data/pascal/p20.json";
import pascalUnit21 from "../src/app/data/pascal/p21.json";
import pascalUnit22 from "../src/app/data/pascal/p22.json";
import { runPascal } from "./pascal";
import { runAltair } from "./altair";
import { runCobol } from "./cobol";
import cobolChapters from "../src/app/data/cobol/chapters.json";
import cobolQuests from "../src/app/data/cobol/quests.json";
import cobolUnit1 from "../src/app/data/cobol/cb1.json";
import cobolUnit2 from "../src/app/data/cobol/cb2.json";
import cobolUnit3 from "../src/app/data/cobol/cb3.json";
import cobolUnit4 from "../src/app/data/cobol/cb4.json";
import cobolUnit5 from "../src/app/data/cobol/cb5.json";
import cobolUnit6 from "../src/app/data/cobol/cb6.json";
import cobolUnit7 from "../src/app/data/cobol/cb7.json";
import cobolUnit8 from "../src/app/data/cobol/cb8.json";
import cobolUnit9 from "../src/app/data/cobol/cb9.json";
import cobolUnit10 from "../src/app/data/cobol/cb10.json";
import cobolUnit11 from "../src/app/data/cobol/cb11.json";
import cobolUnit12 from "../src/app/data/cobol/cb12.json";
import cobolUnit13 from "../src/app/data/cobol/cb13.json";
import cobolUnit14 from "../src/app/data/cobol/cb14.json";
import cobolUnit15 from "../src/app/data/cobol/cb15.json";
import altairChapters from "../src/app/data/altair/chapters.json";
import altairQuests from "../src/app/data/altair/quests.json";
import altairUnit1 from "../src/app/data/altair/al1.json";
import altairUnit2 from "../src/app/data/altair/al2.json";
import altairUnit3 from "../src/app/data/altair/al3.json";
import altairUnit4 from "../src/app/data/altair/al4.json";
import altairUnit5 from "../src/app/data/altair/al5.json";
import altairUnit6 from "../src/app/data/altair/al6.json";
import altairUnit7 from "../src/app/data/altair/al7.json";
import altairUnit8 from "../src/app/data/altair/al8.json";
import altairUnit9 from "../src/app/data/altair/al9.json";
import altairUnit10 from "../src/app/data/altair/al10.json";
import altairUnit11 from "../src/app/data/altair/al11.json";
import altairUnit12 from "../src/app/data/altair/al12.json";
import altairUnit13 from "../src/app/data/altair/al13.json";
import altairUnit14 from "../src/app/data/altair/al14.json";
import altairUnit15 from "../src/app/data/altair/al15.json";

const lessons = (file: { lessons: unknown }) => file.lessons as LessonData[];

// ---------- Dartmouth BASIC (1964) ----------

export const basicCourse = buildCourse({
  id: "basic",
  title: "BASIC",
  year: 1964,
  machine: "Dartmouth Time-Sharing System",
  tagline: "The language that brought programming to everyone.",
  theme: basicTheme,
  chapters: basicChapters.chapters as ChapterJson[],
  lessonsByUnit: {
    u1: unit1File.units[0].lessons as unknown as LessonData[],
    u2: lessons(unit2File),
    u3: lessons(unit3File),
    u4: lessons(unit4File),
    u5: lessons(unit5File),
    u6: lessons(unit6File),
    u7: lessons(unit7File),
    u8: lessons(unit8File),
    u9: lessons(unit9File),
    u10: lessons(unit10File),
    u11: lessons(unit11File),
    u12: lessons(unit12File),
    u13: lessons(unit13File),
    u14: lessons(unit14File),
    u15: lessons(unit15File),
  },
  quests: basicQuests as Record<string, QuestData>,
  run: (code, inputs) => runBasic(code, inputs),
  hasPractice: true,
});

// ---------- 6502 Assembly (1975) ----------
// Lessons and quests live in data/6502. Units without lessons show as "coming soon".

export const asmCourse = buildCourse({
  id: "6502",
  title: "6502 Assembly",
  year: 1975,
  machine: "Single-board computer, 1976",
  tagline: "Talk directly to the chip inside the Apple II, the C64 and the NES.",
  theme: kimTheme,
  chapters: asmChapters.chapters as ChapterJson[],
  lessonsByUnit: {
    a1: lessons(asmUnit1),
    a2: lessons(asmUnit2),
    a3: lessons(asmUnit3),
    a4: lessons(asmUnit4),
    a5: lessons(asmUnit5),
    a6: lessons(asmUnit6),
    a7: lessons(asmUnit7),
    a8: lessons(asmUnit8),
    a9: lessons(asmUnit9),
    a10: lessons(asmUnit10),
    a11: lessons(asmUnit11),
    a12: lessons(asmUnit12),
    a13: lessons(asmUnit13),
    a14: lessons(asmUnit14),
    a15: lessons(asmUnit15),
  },
  quests: asmQuests as Record<string, QuestData>,
  // INPUT answers become typed keys (used when "order the lines" checks programs with GETCH)
  run: (code, inputs, options) => runAsm(code, { keys: inputs.join(""), ...options }),
  editorHint: "LDA #$05",
  hasPractice: true,
  lineStyle: "address",
  canStep: true,
});

// ---------- FORTRAN (1957) ----------

export const fortranCourse = buildCourse({
  id: "fortran",
  title: "FORTRAN",
  year: 1957,
  machine: "IBM 704 · punch cards",
  tagline: "The first real programming language, built for scientists and their formulas.",
  theme: ibmTheme,
  chapters: fortranChapters.chapters as ChapterJson[],
  lessonsByUnit: {
    f1: lessons(fortranUnit1),
    f2: lessons(fortranUnit2),
    f3: lessons(fortranUnit3),
    f4: lessons(fortranUnit4),
    f5: lessons(fortranUnit5),
    f6: lessons(fortranUnit6),
    f7: lessons(fortranUnit7),
    f8: lessons(fortranUnit8),
    f9: lessons(fortranUnit9),
    f10: lessons(fortranUnit10),
    f11: lessons(fortranUnit11),
    f12: lessons(fortranUnit12),
    f13: lessons(fortranUnit13),
    f14: lessons(fortranUnit14),
    f15: lessons(fortranUnit15),
    f16: lessons(fortranUnit16),
    f17: lessons(fortranUnit17),
    f18: lessons(fortranUnit18),
  },
  quests: fortranQuests as Record<string, QuestData>,
  // INPUT values become data cards for READ
  run: (code, inputs) => runFortran(code, inputs),
  editorHint: "      X = 1.0",
  lineStyle: "card",
  hasPractice: true,
});

// ---------- C (1972) ----------

export const cCourse = buildCourse({
  id: "c",
  title: "C",
  year: 1972,
  machine: "PDP-11 · Unix terminal",
  tagline: "The language Unix was written in. C++, Java and JavaScript all grew from it.",
  theme: unixTheme,
  chapters: cChapters.chapters as ChapterJson[],
  lessonsByUnit: {
    c1: lessons(cUnit1),
    c2: lessons(cUnit2),
    c3: lessons(cUnit3),
    c4: lessons(cUnit4),
    c5: lessons(cUnit5),
    c6: lessons(cUnit6),
    c7: lessons(cUnit7),
    c8: lessons(cUnit8),
    c9: lessons(cUnit9),
    c10: lessons(cUnit10),
    c11: lessons(cUnit11),
    c12: lessons(cUnit12),
    c13: lessons(cUnit13),
    c14: lessons(cUnit14),
    c15: lessons(cUnit15),
    c16: lessons(cUnit16),
    c17: lessons(cUnit17),
    c18: lessons(cUnit18),
    c19: lessons(cUnit19),
    c20: lessons(cUnit20),
    c21: lessons(cUnit21),
    c22: lessons(cUnit22),
    c23: lessons(cUnit23),
    c24: lessons(cUnit24),
    c25: lessons(cUnit25),
    c26: lessons(cUnit26),
    c27: lessons(cUnit27),
  },
  quests: cQuests as Record<string, QuestData>,
  // Standard input: each answer is one line
  run: (code, inputs) => runC(code, inputs),
  editorHint: '    printf("hello\\n");',
  lineStyle: "editor",
  hasPractice: true,
});

// ---------- Pascal (1970), as Turbo Pascal on the IBM PC ----------

export const pascalCourse = buildCourse({
  id: "pascal",
  title: "Pascal",
  year: 1970,
  machine: "IBM PC · Turbo Pascal",
  tagline: "Niklaus Wirth's teaching language. With Turbo Pascal, a whole generation learned to program on the PC.",
  theme: turboTheme,
  chapters: pascalChapters.chapters as ChapterJson[],
  lessonsByUnit: {
    p1: lessons(pascalUnit1),
    p2: lessons(pascalUnit2),
    p3: lessons(pascalUnit3),
    p4: lessons(pascalUnit4),
    p5: lessons(pascalUnit5),
    p6: lessons(pascalUnit6),
    p7: lessons(pascalUnit7),
    p8: lessons(pascalUnit8),
    p9: lessons(pascalUnit9),
    p10: lessons(pascalUnit10),
    p11: lessons(pascalUnit11),
    p12: lessons(pascalUnit12),
    p13: lessons(pascalUnit13),
    p14: lessons(pascalUnit14),
    p15: lessons(pascalUnit15),
    p16: lessons(pascalUnit16),
    p17: lessons(pascalUnit17),
    p18: lessons(pascalUnit18),
    p19: lessons(pascalUnit19),
    p20: lessons(pascalUnit20),
    p21: lessons(pascalUnit21),
    p22: lessons(pascalUnit22),
  },
  quests: pascalQuests as Record<string, QuestData>,
  // Keyboard input: each answer is one line typed for readln
  run: (code, inputs) => runPascal(code, inputs),
  editorHint: "  writeln('Hello');",
  lineStyle: "editor",
  closingLine: "end.",
  hasPractice: true,
});

// ---------- Altair 8800 machine code (1975) ----------

export const altairCourse = buildCourse({
  id: "altair",
  title: "Altair 8800",
  year: 1975,
  machine: "MITS Altair 8800 · Intel 8080",
  tagline: "No keyboard, no screen: just switches and lights. The kit that started the personal computer, and Microsoft.",
  theme: altairTheme,
  chapters: altairChapters.chapters as ChapterJson[],
  lessonsByUnit: {
    al1: lessons(altairUnit1),
    al2: lessons(altairUnit2),
    al3: lessons(altairUnit3),
    al4: lessons(altairUnit4),
    al5: lessons(altairUnit5),
    al6: lessons(altairUnit6),
    al7: lessons(altairUnit7),
    al8: lessons(altairUnit8),
    al9: lessons(altairUnit9),
    al10: lessons(altairUnit10),
    al11: lessons(altairUnit11),
    al12: lessons(altairUnit12),
    al13: lessons(altairUnit13),
    al14: lessons(altairUnit14),
    al15: lessons(altairUnit15),
  },
  quests: altairQuests as Record<string, QuestData>,
  // Inputs are the values on the sense switches, one for every IN 377
  run: (code, inputs) => runAltair(code, inputs),
  editorHint: "00 111 110   ; MVI A",
  lineStyle: "octal",
  closingLine: "HLT",
  hasPractice: true,
});

// ---------- COBOL (1959) ----------

export const cobolCourse = buildCourse({
  id: "cobol",
  title: "COBOL",
  year: 1959,
  machine: "IBM System/370 · 3270 terminal",
  tagline: "Grace Hopper's business language reads almost like English, and still moves the world's money.",
  theme: cobolTheme,
  chapters: cobolChapters.chapters as ChapterJson[],
  lessonsByUnit: {
    cb1: lessons(cobolUnit1),
    cb2: lessons(cobolUnit2),
    cb3: lessons(cobolUnit3),
    cb4: lessons(cobolUnit4),
    cb5: lessons(cobolUnit5),
    cb6: lessons(cobolUnit6),
    cb7: lessons(cobolUnit7),
    cb8: lessons(cobolUnit8),
    cb9: lessons(cobolUnit9),
    cb10: lessons(cobolUnit10),
    cb11: lessons(cobolUnit11),
    cb12: lessons(cobolUnit12),
    cb13: lessons(cobolUnit13),
    cb14: lessons(cobolUnit14),
    cb15: lessons(cobolUnit15),
  },
  quests: cobolQuests as Record<string, QuestData>,
  // Inputs are the SYSIN cards, one for every ACCEPT
  run: (code, inputs) => runCobol(code, inputs),
  editorHint: '           DISPLAY "HELLO".',
  lineStyle: "cobol",
  closingLine: "STOP RUN.",
  hasPractice: true,
});

// ---------- All courses ----------

// In the order the languages appeared: FORTRAN 1957, COBOL 1959, BASIC 1964, Pascal 1970, C 1972, then the 1975 machines (Altair 8800, 6502)
export const courses: Course[] = [fortranCourse, cobolCourse, basicCourse, pascalCourse, cCourse, altairCourse, asmCourse].sort((a, b) => a.year - b.year);

export function courseById(id: string): Course | undefined {
  return courses.find((c) => c.id === id);
}

// Lesson ids are unique across all courses, so any screen can find a lesson by id alone
export function findLessonAnywhere(id: string) {
  for (const course of courses) {
    const found = course.findLesson(id);
    if (found) return { course, ...found };
  }
  return null;
}
