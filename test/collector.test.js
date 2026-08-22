import assert from "node:assert/strict";
import test from "node:test";

import { localDate, validateDateRange } from "../src/collector.js";

test("date validation rejects impossible and reversed ranges", () => {
  assert.throws(() => validateDateRange("2026-02-30", "2026-03-01"), /不是有效日期/);
  assert.throws(() => validateDateRange("2026-08-23", "2026-08-01"), /不能晚于/);
  assert.doesNotThrow(() => validateDateRange("2024-02-29", "2024-02-29"));
});

test("default dates are calculated in Asia/Shanghai", () => {
  assert.equal(localDate(new Date("2026-08-22T16:30:00.000Z")), "2026-08-23");
});
