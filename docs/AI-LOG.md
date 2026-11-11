# AI log: what the agent got wrong

Built with a coding agent (Claude Code), as in [project 5](https://github.com/Flaviohorbach/legacy-storefront-refactor). These happened while building this project.

### 1. The same bug as in project 4

The storefront crashed with "destroy is not a function". An effect written as `() => endRef.current?.scrollIntoView()` returned the Promise that `scrollIntoView` now returns in newer browsers, and React tried to call it as a cleanup. The agent had hit and recorded exactly this bug in project 4, and repeated it. **Caught by:** the browser console on the first visit. **Fix:** braces around the effect's body, with a comment saying why.

### 2. An eval case that tested nothing

The first poisoned-catalog attack passed because the assistant answered without searching: the malicious product description never reached the model. A green result was counted as a defense that had not been exercised. **Caught by:** reading the answer and its tool calls instead of the score. **Fix:** a second case makes the assistant open the poisoned product and fails if it did not.

### 3. A rate limit read as a daily quota

The embedding model's free tier counts each text as one request, 100 a minute. The agent planned to embed a 100-product upload in one call, which would fail for any real store. **Caught by:** the first run of the sample build, which hit the limit on the second batch. **Fix:** uploads are saved at once and embedded in batches of 40 a minute from the panel; keyword search works meanwhile.

### 4. A sample catalog with a broken line

The coffee-shop CSV the agent wrote had an unquoted "0,1 g" in a description, which shifted the columns. **Caught by:** the importer's own validation, which reported the line instead of guessing. **Fix:** the field is quoted.

### 5. Removed tests during the copy

Copying project 11's base, the agent deleted its guardrail, router and pricing tests along with the old catalog test. **Caught by:** counting tests after the copy. **Fix:** restored and adapted to the per-store prompt.

### 6. Tests that assumed the wrong behavior

Two tests failed on correct code: vector search returns the nearest products even when weakly related, and a rejected line does not count as a used product code. **Caught by:** the test run. **Fix:** the tests now check order and the right lines.

## What needed a human

- Choosing secret links over accounts, the four features, and the name.
- Creating the GitHub repository, the Vercel project and database, and the secrets.
- Recording the demo video.
