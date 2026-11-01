import { Node, SyntaxKind } from "ts-morph";

const BRANCHES = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.ConditionalExpression,
  SyntaxKind.CaseClause,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
]);

const SHORT_CIRCUITS = new Set([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
]);

/** Cyclomatic complexity: 1 plus every branch, loop, `catch` and short-circuit operator. */
export function cyclomaticComplexity(node: Node): number {
  let complexity = 1;
  node.forEachDescendant((descendant) => {
    if (BRANCHES.has(descendant.getKind())) complexity++;
    else if (
      Node.isBinaryExpression(descendant) &&
      SHORT_CIRCUITS.has(descendant.getOperatorToken().getKind())
    ) {
      complexity++;
    }
  });
  return complexity;
}
