# Short posts: the bookstore assistant goes to production

English translation of `publicaciones-asistente-produccion.md`, made from the version Oliver reviewed on 11/27/2026. The Spanish file is the source: if one changes, update the other.

Notes for the review:

- **Format:** The Lab (Markdown-lite, three paragraphs, English tags). They work the same as LinkedIn posts; add the LinkedIn hashtags listed under each one at the end.
- **Name:** the assistant is called **Melquíades**. The accent stays in English.
- **Translation choices:** numbers use English formatting (2,541; 86.6%; 2.3 MB). Dates are written out ("November 16"). The Spanish quotation marks (« ») become straight quotes. In post 1, "(son muy comunicativos, los malditos)" became "(they are chatty, the rascals)", which keeps the joke without a literal translation.
- **Added for English readers:** post 1 says Le Tiende is a cultural center in Bogotá. The Spanish text doesn't need that.
- **Cleanup with `watermarks-remover`:** done on 11/27/2026. The Unicode audit found 0 invisible characters, in both the English and the Spanish file. The prose got a light pass on four sentences (connectors and word order); the figures, links and structure match the Spanish file. A rewrite reduces statistical patterns on a best-effort basis and proves nothing about authorship.
- **Pending before publishing:** your final read of the English.

---

## 1. Before writing a single line of code

**Tags:** Use Case Definition, AI Governance, Data Exposure, Solution Architecture
**LinkedIn hashtags:** #SolutionArchitecture #GenerativeAI #AIGovernance #ProductManagement

To catch the Christmas sales, on November 16 I started building an AI assistant, called **Melquíades** (after the wise gypsy in **One Hundred Years of Solitude**), for the public catalog of the bookstore at [Le Tiende](https://letiende.co/libros/), a cultural center in Bogotá. A person types "I'm looking for something for my teenage son who likes manga" and gets books that are actually on the shelf, with price and location. Before the first *commit* I wrote a use-case card: problem, users, data, success indicators, risks, and when to hand off to a person. While checking which data the model could see, I found something I wasn't looking for: the public endpoint for each book's page had been returning the full database record for months, **cost, margin and publisher discount included**. No one had noticed, since the interface only rendered what it needed.

I fixed it that same day with a whitelist of fields and a test that fails if any field outside it shows up, and the rule is now written down for the agents that work in the repository: on a public endpoint, you never spread the database item. The [use-case card](https://github.com/ocastelblanco/babel-letiende/blob/main/asistente-ia/fichas/caso-de-uso.md) is still in the repo, dated before any assistant code.

An AI assistant widens what your system exposes to the outside (they are chatty, the rascals), and that question is worth asking before you connect the model, not after. What I found wasn't a model risk: it was application debt, which the model would have inherited and repeated with great confidence. What would an audit of your endpoints show if you ran it thinking about what a model could read?

---

## 2. The 0% I didn't expect

**Tags:** RAG, Knowledge Sources, Data Engineering, Cost Optimization
**LinkedIn hashtags:** #RAG #DataEngineering #GenerativeAI #AWS

To recommend the books at [Le Tiende](https://letiende.co/libros/) by their content, **Melquíades**, the AI assistant I built, needs synopses, and the inventory didn't have them. The obvious plan was to fetch them from Google Books by ISBN. I measured it across the **2,541 books** in the real inventory: Google Books returned **0** useful synopses (200 characters or more). The coverage came from six Colombian websites with bibliographic information, queried one after another until one returned text: **2,201 books with a useful synopsis, 86.6%**. The other 13.4% are described by title, author and category, and **Melquíades** knows it.

I skipped the trendy recipe for the index, too. At 2,541 books there's no need for a managed vector database: the *embeddings* (768 dimensions, quantized) fit in a **2.3 MB file on S3** that the Lambda loads and compares in memory. The full build in production took **50 seconds**, and every 6 hours only what changed gets updated. Search is hybrid: hard filters first (language, price, stock), then meaning. The [data log](https://github.com/ocastelblanco/babel-letiende/blob/main/asistente-ia/bitacora/01-datos-sinopsis.md) has the coverage by source and by language.

The quality of a retrieval assistant is decided by its knowledge source long before the model, and the source everyone takes for granted may not work for your catalog. Measuring coverage before writing the first prompt saved me from building on an assumption. Which knowledge source in your assistant have you never measured?

---

## 3. The suite missed it; a person caught it

**Tags:** LLM Evaluation, Regression Testing, Prompt Versioning, Guardrails
**LinkedIn hashtags:** #LLMEvaluation #PromptEngineering #QA #ResponsibleAI

No prompt change to **Melquíades**, the AI assistant for the **Le Tiende** bookstore, gets in without passing an evaluation suite: **52 cases** with hand-picked acceptable books, price and language constraints, questions with no possible answer, bookstore policies and injection attempts. There are four exit criteria that must come out at zero, or close: invented books, out-of-stock books, successful injections, and fewer than 90% of constraints met. The prompt is at version 6, but **production runs version 5**: v6 met 11 of 21 constraint cases against v5's 15 of 21, so it wasn't adopted, even though it "looked better".

Still, the most useful catch came from a person. While testing by hand, **Melquíades** answered "there are 5 copies left, on the first floor" without checking the inventory; the real figure was 1 copy in another room. I reproduced it: **2 out of 3 attempts made it up**. The prompt already said "always check availability", and the model sometimes didn't. The fix wasn't another prompt but a server-side guard that detects the question, forces the tool call and, if there is still no verified data, returns a notice instead of the number. After that: 10 out of 10. The [version history](https://github.com/ocastelblanco/babel-letiende/blob/main/asistente-ia/prompts/CHANGELOG.md) has every change with its reason and its measured effect.

An instruction in the prompt is a preference, not a control: whatever can't fail gets verified in code. And the suite only measures what you already imagined; manual testing keeps finding what nobody wrote down as a case. Which critical rule in your assistant depends only on the model obeying?

---

## 4. Turning it on without crossing my fingers

**Tags:** AI Security, OWASP LLM Top 10, Privacy by Design, FinOps
**LinkedIn hashtags:** #CyberSecurity #OWASP #DataPrivacy #FinOps

A public AI chat is an open endpoint that costs money on every message and takes text from anyone. Before switching on **Melquíades**, the assistant for the **Le Tiende** bookstore, I added the controls I'd demand from anyone else's system: a **daily spending cap** ($3 in production), **30 messages per visitor per day**, a rate limit in API Gateway (2 per second, bursts of 10) and an emergency switch. The suite includes **11 injection attempts**, 3 of them hidden inside a synopsis, which is third-party text: 0 succeeded. A fidelity validator strips from the answer any price, schedule or phone number that doesn't come from a verified source.

Privacy is in the design, not in a policy: each query is stored for 90 days **without the IP, with emails, phone numbers and documents masked**, and the thumbs-up or thumbs-down rating is tied to the IP with a salt that changes every day. The public response is a whitelist of fields. I reviewed the whole thing with my OWASP verification skill (ASVS 5.0 level 2 plus the Top 10 for LLMs), and when the model provider got overloaded in the middle of a deployment, the visitor got a quote from Cervantes, Machado or Larra instead of a 503 error. The [secure-operation log](https://github.com/ocastelblanco/babel-letiende/blob/main/asistente-ia/bitacora/08-operacion-segura.md) details each control.

On November 24 it went live in production, **for staff only**, three days ahead of the target date. Opening it to the public waits for whoever answers for the bookstore's data to review the privacy notice: the code can't decide that control. Does your assistant go to production with a switch and a spending cap, or with the hope that nobody uses it too much?
