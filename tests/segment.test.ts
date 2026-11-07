// The site's segmentation score: politics and diplomacy count as market information; forum
// chatter and content-free lines do not. Scores run 0–100 against industry/relevance.ts.
import assert from "node:assert/strict";
import test from "node:test";
import { scoreMaterial } from "../packages/backend/src/editorial/segment.ts";

const score = (title: string, body = "", tier = "T2", excerpt = "") =>
  scoreMaterial({ title, bodyText: body, excerpt, translationZh: null, source: { tier } });

test("a geopolitical brief from a wire is 精选 on its place and event", () => {
  const jin10 = score(
    "【英媒：英国正筹备2027年接待泽连斯基进行国事访问】金十数据11月7日讯，据英国金融时报援引知情人士透露，英国正筹备于明年接待乌克兰总统泽连斯基进行国事访问。",
  );
  assert.ok(jin10.selected, `score ${jin10.score}: ${jin10.labels.join("、")}`);
  assert.ok(jin10.labels.includes("英国"));
  assert.ok(jin10.labels.includes("国事访问"));

  const missile = score("沙特领导的联军：拦截并摧毁了一枚飞向利雅得的胡塞武装巡航导弹。");
  assert.ok(missile.selected, `score ${missile.score}`);

  const sanctions = score("US Treasury Unveils Fresh Sanctions Targeting Iran's Oil Exports");
  assert.ok(sanctions.selected, `score ${sanctions.score}`);
});

test("politics without market machinery still scores on its place and event", () => {
  const election = score("【加州选民预计否决亿万富翁财富税提案】据选举预测机构决策台总部（DDH）测算。");
  assert.ok(election.labels.includes("选举"), "the election event is recognised even though this names no place");
});

test("chatter, staffing and content-free lines stay out of 精选", () => {
  for (const title of [
    "Trump Wants Stephen Miller to Ensure Smooth Operations in Chief of Staff Role",
    "Trump Reveals Decision to Make a Change",
    "哎。老了",
    "11.06",
    "China sends four satellites into orbit aboard a CERES-2 Y3 carrier rocket on Saturday.",
    "Chinese EV brands Seres and Li Auto step up expansion into European markets.",
  ]) {
    assert.equal(score(title).selected, false, `${title} -> ${score(title).score}`);
  }
});

test("spam words in the headline or teaser disqualify, even on a trusted source", () => {
  const spam = score("[红包]11.6赚没赚钱都去好好消费，花掉的money才是自己的");
  assert.equal(spam.selected, false);
  assert.equal(spam.noise, "红包");
  // A legitimate article may quote the same word in its body.
  const quoted = score("美联储维持利率不变", "评论区有人提到红包，与本文无关。");
  assert.ok(quoted.selected, "body text does not trigger the spam list");
});

test("a trusted-tier source gets a head start but the text still has to say something", () => {
  const bare = score("A bittersweet year for liberals", "", "T1");
  assert.equal(bare.selected, false);
  const official = score("美联储宣布下调利率25个基点", "", "T1");
  assert.ok(official.score > bare.score);
});
