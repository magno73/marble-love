/**
 * ESLint custom rule: no-raw-arith-on-branded
 *
 * Rejects direct arithmetic/bitwise operators (+ - * / % << >> >>> & | ^) on
 * values declared as branded numeric types `u8 | u16 | u32 | i8 | i16 | i32`.
 *
 * Rationale: TypeScript uses float64 by default. Marble Love needs exact
 * 68010-style 16/32-bit arithmetic, so engine code should use branded types and
 * explicit helpers from `engine/src/wrap.ts` (`u16_add`, `u32_mul`, etc.).
 *
 * This rule does not attempt full type inference. It recognizes local syntactic
 * patterns instead:
 *
 *   1. Variables with explicit annotation `: u8`/`: u16`/`: u32`/`: i8`/`: i16`/`: i32`
 *   2. Cast `as u8`/`as u16`/...
 *   3. Function parameters typed as uX/iX
 *
 * When either operand of a relevant expression matches one of those patterns,
 * the rule reports it and points callers at `wrap.ts`.
 *
 * Esempi:
 *   const a: u16 = 0xFFFF;
 *   const b: u16 = 1;
 *   const c = a + b;         // use u16_add(a, b)
 *   const d = u16_add(a, b); // ok
 */

const BRANDED_NUMERIC = new Set(["u8", "u16", "u32", "i8", "i16", "i32"]);
const BANNED_OPS = new Set([
  "+", "-", "*", "/", "%",
  "<<", ">>", ">>>",
  "&", "|", "^",
  "**",
]);
const BANNED_ASSIGN_OPS = new Set([
  "+=", "-=", "*=", "/=", "%=",
  "<<=", ">>=", ">>>=",
  "&=", "|=", "^=",
  "**=",
]);
const BANNED_UPDATE_OPS = new Set(["++", "--"]);
const BANNED_UNARY_OPS = new Set(["-", "+", "~"]);

/**
 * Extracts the simple name of a TSTypeReference.
 * Examples: "u16" from `: u16`, "u16" from `as u16`, "u16" from `<u16>`.
 */
function typeRefName(typeNode) {
  if (!typeNode) return null;
  if (typeNode.type === "TSTypeReference" && typeNode.typeName) {
    if (typeNode.typeName.type === "Identifier") return typeNode.typeName.name;
  }
  return null;
}

function isBrandedTypeAnnotation(annotation) {
  if (!annotation || !annotation.typeAnnotation) return false;
  const name = typeRefName(annotation.typeAnnotation);
  return name !== null && BRANDED_NUMERIC.has(name);
}

/**
 * Determines whether an expression is branded through local syntax only.
 *  - TSAsExpression: as u16
 *  - TSTypeAssertion: <u16>x
 *  - Identifier that resolves to a declaration with a branded annotation,
 *    best-effort within local file scope.
 */
function isBrandedExpression(node, scopeManager, currentScope) {
  if (!node) return false;
  // as u16
  if (node.type === "TSAsExpression" || node.type === "TSTypeAssertion") {
    const name = typeRefName(node.typeAnnotation);
    if (name && BRANDED_NUMERIC.has(name)) return true;
    return isBrandedExpression(node.expression, scopeManager, currentScope);
  }
  // Identifier: walk scopes to find the declaration.
  if (node.type === "Identifier" && currentScope) {
    let scope = currentScope;
    while (scope) {
      const ref = scope.variables.find((v) => v.name === node.name);
      if (ref) {
        for (const def of ref.defs) {
          // const a: u16 = ...
          if (def.node?.id?.typeAnnotation && isBrandedTypeAnnotation(def.node.id.typeAnnotation)) {
            return true;
          }
          // function f(a: u16) { ... }
          if (def.type === "Parameter" && def.node?.typeAnnotation && isBrandedTypeAnnotation(def.node.typeAnnotation)) {
            return true;
          }
        }
        return false;
      }
      scope = scope.upper;
    }
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Rejects direct arithmetic/bitwise operations on branded u8/u16/u32/i8/i16/i32 values. Use helpers from engine/src/wrap.ts.",
    },
    schema: [],
    messages: {
      banned:
        "Operation `{{op}}` on branded type `{{kind}}` is not allowed. Use the wrap.ts helper instead, such as `u16_add` or `u32_mul`.",
      bannedUpdate:
        "Operator `{{op}}` on a branded type is not allowed. Use `u16_add(x, 1)` or an equivalent helper.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const scopeManager = sourceCode.scopeManager;
    let currentScope = scopeManager?.globalScope ?? null;

    function enter(node) {
      currentScope = sourceCode.getScope ? sourceCode.getScope(node) : currentScope;
    }

    function checkOperand(node, op) {
      if (isBrandedExpression(node, scopeManager, currentScope)) {
        context.report({
          node,
          messageId: "banned",
          data: { op, kind: "uX/iX" },
        });
        return true;
      }
      return false;
    }

    return {
      "*": enter,

      BinaryExpression(node) {
        if (!BANNED_OPS.has(node.operator)) return;
        if (checkOperand(node.left, node.operator)) return;
        checkOperand(node.right, node.operator);
      },

      AssignmentExpression(node) {
        if (!BANNED_ASSIGN_OPS.has(node.operator)) return;
        if (checkOperand(node.left, node.operator)) return;
        checkOperand(node.right, node.operator);
      },

      UpdateExpression(node) {
        if (!BANNED_UPDATE_OPS.has(node.operator)) return;
        if (isBrandedExpression(node.argument, scopeManager, currentScope)) {
          context.report({
            node,
            messageId: "bannedUpdate",
            data: { op: node.operator },
          });
        }
      },

      UnaryExpression(node) {
        if (!BANNED_UNARY_OPS.has(node.operator)) return;
        // - and ~ are the practical hazards; + is coercion but is banned for consistency.
        checkOperand(node.argument, node.operator);
      },
    };
  },
};

export default rule;
