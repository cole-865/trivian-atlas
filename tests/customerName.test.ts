import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerName,
  splitCustomerName,
} from "../src/lib/deals/customerName.js";

test("splitCustomerName separates first and last names for seeded deal entry", () => {
  assert.deepEqual(splitCustomerName("Cole Hitchcox"), {
    firstName: "Cole",
    lastName: "Hitchcox",
  });

  assert.deepEqual(splitCustomerName("Mary Ann Smith"), {
    firstName: "Mary",
    lastName: "Ann Smith",
  });
});

test("splitCustomerName handles empty and partial values safely", () => {
  assert.deepEqual(splitCustomerName(""), {
    firstName: "",
    lastName: "",
  });

  assert.deepEqual(splitCustomerName("Prince"), {
    firstName: "Prince",
    lastName: "",
  });
});

test("buildCustomerName joins first and last name without extra whitespace", () => {
  assert.equal(buildCustomerName(" Cole ", " Hitchcox "), "Cole Hitchcox");
  assert.equal(buildCustomerName("Prince", null), "Prince");
  assert.equal(buildCustomerName("", ""), null);
});
