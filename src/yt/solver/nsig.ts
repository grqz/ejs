import { generate } from "astring";
import { type ESTree } from "meriyah";

import { type DeepPartial } from "../../types.ts";
import { matchesStructure, generateArrowFunction } from "../../utils.ts";

const identifier: DeepPartial<ESTree.Node> = {
  or: [
    {
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        operator: "=",
        left: {
          or: [{ type: "Identifier" }, { type: "MemberExpression" }],
        },
        right: {
          type: "FunctionExpression",
          async: false,
        },
      },
    },
    {
      type: "FunctionDeclaration",
      async: false,
      id: { type: "Identifier" },
    },
    {
      type: "VariableDeclaration",
      declarations: {
        anykey: [
          {
            type: "VariableDeclarator",
            init: {
              type: "FunctionExpression",
              async: false,
            },
          },
        ],
      },
    },
  ],
} as const;

// we want to match "alr", arr[1234], or arr[K^5678]
function alrYesLike(
  [set, alr, yes]: DeepPartial<ESTree.Expression>[],
  notComputed?: boolean,
): DeepPartial<ESTree.ExpressionStatement> {
  return {
    type: "ExpressionStatement",
    expression: {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: { type: "Identifier" },
        computed: !notComputed,
        property: set,
        optional: false,
      },
      arguments: [alr, yes],
      optional: false,
    },
  };
}

const asdasd = alrYesLike([{
  type: "Identifier",
  name: "set",
}, {
  type: "Literal",
  value: "alr",
}, {
  type: "Literal",
  value: "yes",
}], true);

function unwrapCondLike(predVar: string, stmt: ESTree.Statement): ESTree.Statement[] | null {
  const matchTestSub: DeepPartial<ESTree.Expression> = {
    or: [{ type: "Literal" }, { type: "Identifier", name: predVar }],
  };
  const predicate: DeepPartial<ESTree.Expression> = {
    or: [{
      type: "BinaryExpression",
      left: matchTestSub,
      right: matchTestSub,
      operator: { or: ["+", "-", "&", "^", "|", "<<", ">>", ">>>", "==", "===", "!=", "!==", ">", "<", ">=", "<=", "*"] },
    }, {
      type: "UnaryExpression",
      argument: matchTestSub,
      operator: { or: ["+", "-", "!", "~", "void"] },
    }, {
      type: "LogicalExpression",
      left: matchTestSub,
      right: matchTestSub,
    }],
  };
  matchTestSub.or.push(...predicate.or);
  if (matchesStructure(stmt, {
    type: "IfStatement",
    test: predicate,
  })) {
    const { consequent } = stmt as ESTree.IfStatement;
    if (consequent.type === "BlockStatement")
      return consequent.body;
    return [consequent];
  }

  if (matchesStructure(stmt, {
    type: "ExpressionStatement",
    expression: {
      type: "LogicalExpression",
      left: predicate,
    },
  })) {
    const { expression: expr } = stmt as ESTree.ExpressionStatement;
    const { right } = expr as ESTree.LogicalExpression;
    if (right.type === "SequenceExpression")
      return right.expressions.map(expression=>({
        type: "ExpressionStatement",
        expression
      }));
    return [{
      type: "ExpressionStatement",
      expression: right,
    }];
  }

  return null;
  // TODO: ConditionalExpression doesn't seem to be used
  // should we support it?
}

const strArrInit: DeepPartial<ESTree.Expression> = {
  or: [{
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      object: { type: "Literal" },
      computed: false,
      property: {
        type: "Identifier",
        name: "split",
      },
      optional: false,
    },
    arguments: [
      { type: "Literal" }
    ],
  }, {
    type: "ArrayExpression",
  }],
} as const;

const strArr: DeepPartial<ESTree.Statement> = {
  or: [{
    type: "VariableDeclaration",
    declarations: [{
      type: "VariableDeclarator",
      id: { type: "Identifier" },
      init: strArrInit,
    }],
  }, {
    type: "ExpressionStatement",
    expression: {
      type: "AssignmentExpression",
      left: { type: "MemberExpression", },
      right: strArrInit,
    },
  }],
} as const;

export type FindArrRet = {arr: ESTree.Identifier | ESTree.MemberExpression, indices: [number, number, number] };
export function findArr(
  stmts: ESTree.Statement[],
): FindArrRet | null {
  for (const stmt of stmts) {
    if (!matchesStructure(stmt, strArr))
      continue;
    let arrName: FindArrRet["arr"] | undefined;
    let init: ESTree.CallExpression | ESTree.ArrayExpression | undefined;
    if (stmt.type === "VariableDeclaration") {
      arrName = stmt.declarations[0].id as ESTree.Identifier;
      init = stmt.declarations[0].init as ESTree.CallExpression | ESTree.ArrayExpression;
    } else {
      const { expression: expr } = stmt as ESTree.ExpressionStatement;
      const { left, right } = expr as ESTree.AssignmentExpression;
      arrName = left as ESTree.MemberExpression;
      init = right as ESTree.CallExpression | ESTree.ArrayExpression;
    }
    let arr: string[] | undefined = undefined;
    if (init?.type === "CallExpression") {
      const { arguments: [delimLit], callee: { object: joinedStrLit } } = init;
      const { value: delim } = delimLit as ESTree.Literal,
        { value: joinedStr } = joinedStrLit as ESTree.Literal;
      if (typeof joinedStr !== "string" || typeof delim !== "string")
        continue;

      arr = joinedStr.split(delim);
    } else {
      const { elements } = init as ESTree.ArrayExpression;
      if (!elements.every(elem=>elem?.type === "Literal" && typeof elem.value === "string"))
        continue;
      arr = elements.map(elem=>(elem as ESTree.Literal).value as string);
    }

    const indices: Partial<FindArrRet["indices"]> = [];
    arr.forEach((str, ind)=>{
      const idx = ["set", "alr", "yes"].indexOf(str);
      if (idx !== -1)
        indices[idx] = ind;
    });
    if (Object.keys(indices).length !== 3)
      continue;
    console.log(`debug: ${generate(arrName)}, ${JSON.stringify(indices)}`)
    return {
      arr: arrName,
      indices: indices as FindArrRet["indices"],
    }
  }
  return null;
}

export function extract(
  node: ESTree.Node,
  findArrRet: FindArrRet | null,
): ESTree.ArrowFunctionExpression | null {
  if (!matchesStructure(node, identifier)) {
    return null;
  }

  const options: {
    name: ESTree.Expression;
    params: ESTree.Parameter[];
    statements: ESTree.Statement[];
  }[] = [];

  if (node.type === "FunctionDeclaration") {
    if (node.id && node.body?.body) {
      options.push({
        name: node.id,
        params: node.params,
        statements: node.body?.body,
      });
    }
  } else if (node.type === "ExpressionStatement") {
    if (node.expression.type !== "AssignmentExpression") {
      return null;
    }
    const name = node.expression.left;
    const body = (node.expression.right as ESTree.FunctionExpression)?.body
      ?.body;
    if (name && body) {
      options.push({
        name: name,
        params: (node.expression.right as ESTree.FunctionExpression).params,
        statements: body,
      });
    }
  } else if (node.type === "VariableDeclaration") {
    for (const declaration of node.declarations) {
      const name = declaration.id;
      const body = (declaration.init as ESTree.FunctionExpression)?.body?.body;
      if (name && body) {
        options.push({
          name: name,
          params: (declaration.init as ESTree.FunctionExpression).params,
          statements: body,
        });
      }
    }
  }

  const rawIdx = findArrRet !== null ? alrYesLike(
    findArrRet.indices.map((x): DeepPartial<ESTree.MemberExpression>=>({
      type: "MemberExpression",
      object: findArrRet.arr,
      computed: true,
      property: {
        type: "Literal",
        value: x,
      },
      optional: false,
    }))) : undefined;
  for (const { name, params, statements } of options) {
    // can we modify matchesStructure to extract a value like traverse_obj does?
    if (matchesStructure(statements, { anykey: [asdasd] })) {
      return createSolver(name);
    }
    else if (findArrRet !== null) {
      if (matchesStructure(statements, { anykey: [rawIdx] }))
        return createSolver(name);
      // cant use anykey :(
      if (!matchesStructure(statements[statements.length - 1], {
        type: "ReturnStatement",
        argument: { type: "Identifier" },
      }))
        continue;
      if (params.length < 5 || params[0].type !== "Identifier")
          continue;
      const predVar = params[0].name;

      const { argument: retExpr } = statements[statements.length - 1] as ESTree.ReturnStatement;
      const { name: retVar } = retExpr as ESTree.Identifier;
      let funcInfo: {
        prologue: ESTree.VariableDeclaration;
        keyName: string;
        xoredStruct: DeepPartial<ESTree.ExpressionStatement>;
      } | undefined;
      for (const stmt of statements) {
        if (funcInfo === undefined) {
          if (matchesStructure(stmt, {
            type: "VariableDeclaration",
            declarations: [{
              type: "VariableDeclarator",
              id: { type: "Identifier" },
              init: {
                type: "BinaryExpression",
                left: { type: "Identifier" },
                right: { type: "Identifier" },
                operator: "^",
              },
            }],
          })) {
            const prologue = stmt as ESTree.VariableDeclaration;
            const keyName = (prologue.declarations[0].id as ESTree.Identifier).name;
            const xored: DeepPartial<ESTree.MemberExpression> = {
              type: "MemberExpression",
              object: findArrRet.arr,
              computed: true,
              property: {
                type: "BinaryExpression",
                operator: "^",
                anykey: [
                  {
                    type: "Identifier",
                    name: keyName,
                  },
                  { type: "Literal" },
                ],
              },
              optional: false,
            };
            funcInfo = {
              prologue,
              keyName,
              xoredStruct: alrYesLike([xored, xored, xored]),
            }
            continue;
          }
          break;
        }
        const { prologue, keyName, xoredStruct } = funcInfo;
        const body = unwrapCondLike(predVar, stmt);
        if (body === null)
          continue;
        for (const bStmt of body) {
          if (!matchesStructure(bStmt, xoredStruct))
            continue;
          console.log(`candidate func ${generate(name)}`);
          const { expression: expr } = bStmt as ESTree.ExpressionStatement;
          const { callee, arguments: [kAlr, kYes] } = expr as ESTree.CallExpression;
          const { property: kSet } = callee as ESTree.MemberExpression;

          const { indices } = findArrRet!;

          let lastKey: number | undefined;
          if ([kSet, kAlr, kYes].some((x, ind)=>{
            const { property } = x as ESTree.MemberExpression;
            const { left, right } = property as ESTree.BinaryExpression;
            const identAndLit = left.type === "Identifier" ? [left, right] : [right, left];
            const [{name: curKeyName}, {value: v}] = identAndLit as [ESTree.Identifier, ESTree.Literal];
            if (typeof v !== "number")
              return true;
            const key = v ^ indices[ind];
            if (lastKey === undefined)
              lastKey = key;
            return key !== lastKey || curKeyName !== keyName;
          }) || lastKey === undefined)  // make the type checker happy
            continue;

          if (matchesStructure(body[body.length - 1], {
            type: "VariableDeclaration",
            declarations: [{
              type: "VariableDeclarator",
              id: { type: "Identifier", name: retVar },
            }],
          })) {
            const { declarations: [{ init: right }] } = body[body.length - 1] as ESTree.VariableDeclaration;
            if (right === null) continue;
            body[body.length - 1] = {
              type: "ExpressionStatement",
              expression: {
                type: "AssignmentExpression",
                operator: "=",
                left: { type: "Identifier", name: retVar },
                right,
              }
            }
          }
          else if (!matchesStructure(body[body.length - 1], {
            type: "ExpressionStatement",
            expression: {
              type: "AssignmentExpression",
              operator: "=",
              left: { type: "Identifier", name: retVar },
            },
          }))
            continue;
          console.log(`found func ${generate(name)}`);
          // is it bad to modify the tree?
          prologue.declarations[0].init = {
            type: "Literal",
            value: lastKey,
          };
          prologue.declarations.push({
            type: "VariableDeclarator",
            id: { type: "Identifier", name: retVar },
            init: null,
          });
          const deadifs = statements.filter(st=>st.type === "IfStatement");
          deadifs.forEach(st=>st.test = { type: "Literal", value: false });
          return createSolver({
            type: "ArrowFunctionExpression",
            params: params.slice(2),
            body: {
              type: "BlockStatement",
              body: [
                prologue,
                {
                  type: "BlockStatement",
                  body
                },
                {
                  type: "ReturnStatement",
                  argument: { type: "Identifier", name: retVar },
                },
                ...deadifs,
              ],
            },
            async: false,
            expression: false,
            generator: false,
          });
        }
      }
    }
  }
  return null;
}

function createSolver(
  expression: ESTree.Expression,
): ESTree.ArrowFunctionExpression {
  return generateArrowFunction(`
({sig, n}) => {
  const url = (${generate(expression)})("https://youtube.com/watch?v=yt-dlp-wins", "s", sig ? encodeURIComponent(sig) : undefined);
  url.set("n", n);
  const proto = Object.getPrototypeOf(url);
  const keys = Object.keys(proto).concat(Object.getOwnPropertyNames(proto));
  for (const key of keys) {
    if (!["constructor", "set", "get", "clone"].includes(key)) {
      url[key]();
      break;
    }
  }
  const s = url.get("s");
  return {
    sig: s ? decodeURIComponent(s) : null,
    n: url.get("n") ?? null,
  };
}
`);
}
