import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { matchKind } from "../server.ts";

after(closeDb);

test("a headline that reports a move is matched, ordinary news is not", () => {
  // The words a move comes with, in the wires' Chinese and English.
  assert.equal(matchKind("某公司股票涨停，股价封板")?.kind, "limit");
  assert.equal(matchKind("某公司股票停牌核查")?.kind, "halt");
  assert.equal(matchKind("国内商品期货收盘涨停")?.kind, "limit");
  assert.equal(matchKind("比特币跌破 69000 美元")?.kind, "spike");
  assert.equal(matchKind("Bitcoin plunges to $68,000")?.kind, "spike");
  assert.equal(matchKind("Bitcoin falls to 12-week low")?.kind, "extreme");
  assert.equal(matchKind("Gemini trading volume drops 73% as Q3 revenue falls")?.kind, "spike");
  // Ordinary news must not be read as a move.
  assert.equal(matchKind("央行开展公开市场操作"), null);
  assert.equal(matchKind("美国CFTC计划对美国的铝价机制进行全面改革"), null);
  assert.equal(matchKind("某公司发布年度业绩预告"), null);
});

test("a headline that reports a small change is not a move", () => {
  // A fall of a few percent is a report, not an unusual move; twenty percent or more is one.
  assert.equal(matchKind("Shares fell 5% after the close"), null);
  assert.equal(matchKind("Shares fell 25% after the close")?.kind, "spike");
});
