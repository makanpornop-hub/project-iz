import { test } from "node:test";
import assert from "node:assert/strict";
import { submitChatOnEnter } from "../src/components/chat-photo";
test("Enter sends once while Shift+Enter and IME keep composing the message", () => {
  let submitted = 0,
    prevented = 0;
  const event = (changes: any = {}) =>
    ({
      key: "Enter",
      shiftKey: false,
      repeat: false,
      nativeEvent: { isComposing: false },
      currentTarget: { form: { requestSubmit: () => submitted++ } },
      preventDefault: () => prevented++,
      ...changes,
    }) as any;
  submitChatOnEnter(event({ shiftKey: true }));
  submitChatOnEnter(event({ nativeEvent: { isComposing: true } }));
  submitChatOnEnter(event({ key: "v" }));
  assert.equal(submitted, 0);
  assert.equal(prevented, 0);
  submitChatOnEnter(event());
  submitChatOnEnter(event({ repeat: true }));
  assert.equal(submitted, 1);
  assert.equal(prevented, 2);
});
