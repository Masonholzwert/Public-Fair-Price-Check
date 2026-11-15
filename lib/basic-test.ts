import { runBasic } from "./basic";

const programs = [
  // 1. The pizza quest solution
  `10 LET P = 24
20 LET F = 3
30 PRINT P / F
40 END`,

  // 2. Text, comma zones and precedence
  `10 PRINT "HELLO"
20 PRINT "SUM", 2 + 3 * 4
30 END`,

  // 3. Missing LET
  `10 A = 5
20 END`,

  // 4. Variable that was never set
  `10 PRINT X
20 END`,

  // 5. Forgot END
  `10 PRINT "HI"`,
];

for (const program of programs) {
  console.log("------------------------");
  console.log(program);
  const result = runBasic(program);
  console.log(">>> OUTPUT:");
  console.log(result.output);
  if (result.error) console.log(">>> ERROR: " + result.error);
}