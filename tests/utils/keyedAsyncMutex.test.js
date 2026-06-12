import { withKeyedAsyncMutex } from "../../utils/keyedAsyncMutex.js";

describe("withKeyedAsyncMutex", () => {
  it("runs different keys in parallel", async () => {
    const order = [];
    await Promise.all([
      withKeyedAsyncMutex("a", async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("a-end");
      }),
      withKeyedAsyncMutex("b", async () => {
        order.push("b-start");
        await new Promise((r) => setTimeout(r, 5));
        order.push("b-end");
      }),
    ]);
    expect(order.indexOf("b-end")).toBeLessThan(order.indexOf("a-end"));
  });

  it("serializes work on the same key", async () => {
    const order = [];
    await Promise.all([
      withKeyedAsyncMutex("same", async () => {
        order.push("first-start");
        await new Promise((r) => setTimeout(r, 25));
        order.push("first-end");
        return 1;
      }),
      withKeyedAsyncMutex("same", async () => {
        order.push("second-start");
        order.push("second-end");
        return 2;
      }),
    ]);
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });
});
