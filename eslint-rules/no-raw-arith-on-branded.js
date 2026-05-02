/**
 * ESLint custom rule: no-raw-arith-on-branded
 *
 * Vieta operatori aritmetici/bitwise diretti (+ - * / % << >> >>> & | ^) su
 * valori dichiarati come tipi branded `u8 | u16 | u32 | i8 | i16 | i32`.
 *
 * Motivazione: TypeScript usa float64 di default. Marble Love deve replicare
 * aritmetica 16/32-bit del 68010 esattamente. Soluzione standard: branded
 * types + helper espliciti in `engine/src/wrap.ts` (`u16_add`, `u32_mul`, etc).
 *
 * La rule NON tenta type-inference completa (richiederebbe TypeChecker via
 * @typescript-eslint/parser). Invece riconosce pattern sintattici:
 *
 *   1. Variabili con annotation esplicita `: u8`/`: u16`/`: u32`/`: i8`/`: i16`/`: i32`
 *   2. Cast `as u8`/`as u16`/...
 *   3. Parametri di funzione tipizzati come uX/iX
 *
 * Quando uno qualunque degli operandi di un BinaryExpression aritmetico/bitwise
 * cade in uno di questi casi, la rule fallisce e suggerisce l'helper di wrap.ts.
 *
 * Esempi:
 *   const a: u16 = 0xFFFF;
 *   const b: u16 = 1;
 *   const c = a + b;        // ❌ usare u16_add(a, b)
 *   const d = u16_add(a, b); // ✅
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
 * Estrae il nome semplice di un TSTypeReference.
 * Esempi: "u16" da `: u16`, "u16" da `as u16`, "u16" da `<u16>`.
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
 * Determina se un'espressione è "branded" tramite analisi sintattica locale.
 *  - TSAsExpression: as u16
 *  - TSTypeAssertion: <u16>x
 *  - Identifier che risale a una declaration con annotation branded (best-effort
 *    su scope locale del file)
 */
function isBrandedExpression(node, scopeManager, currentScope) {
  if (!node) return false;
  // as u16
  if (node.type === "TSAsExpression" || node.type === "TSTypeAssertion") {
    const name = typeRefName(node.typeAnnotation);
    if (name && BRANDED_NUMERIC.has(name)) return true;
    return isBrandedExpression(node.expression, scopeManager, currentScope);
  }
  // Identifier: risali allo scope per trovare la dichiarazione
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
        "Vieta aritmetica/bitwise diretta su valori branded u8/u16/u32/i8/i16/i32. Usa gli helper di engine/src/wrap.ts.",
    },
    schema: [],
    messages: {
      banned:
        "Operazione `{{op}}` su tipo branded `{{kind}}` vietata. Usa l'helper di wrap.ts (es. `u16_add`, `u32_mul`).",
      bannedUpdate:
        "Operatore `{{op}}` su tipo branded vietato. Usa `u16_add(x, 1)` o equivalente.",
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
        // Solo - e ~ sono problematici in pratica; + è coercion ma vietiamolo per coerenza
        checkOperand(node.argument, node.operator);
      },
    };
  },
};

export default rule;
