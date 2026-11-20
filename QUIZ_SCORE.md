You can combine them by turning each quiz answer into a **q score (0–5)** automatically, and then feeding that score into the same SM-2 formula. The flash card self-rating is subjective ("I think I knew it"), while the quiz result is objective ("I actually got it right"), so the quiz should carry more weight.

## 1. Convert a quiz answer into a q score

For each quiz question linked to a card, collect whether the answer was correct, the response time `t` in seconds, whether a hint was used, and the question type.

**Time factor** (how quickly the user answered, from 0 to 1):

$$T = \text{clamp}\left(\frac{t_{slow} - t}{t_{slow} - t_{fast}},\ 0,\ 1\right)$$

For example, with $t_{fast} = 5$ s and $t_{slow} = 20$ s, answering in 5 s or less gives $T = 1$, and answering in 20 s or more gives $T = 0$.

**Quiz q score:**

- If correct: $q_{quiz} = 3 + 2T - H$
- If wrong: $q_{quiz} = 2$ for a near miss (such as a typo or a partially correct answer), otherwise $q_{quiz} = 1$

Here $H = 1$ if a hint was used, otherwise $H = 0$. Then clamp $q_{quiz}$ to the range 0–5.

**Guessing adjustment:** a correct answer on multiple choice could be a lucky guess, so cap it at 4 for multiple choice and 3 for true/false. Typed or written answers can reach the full 5.

## 2. Combine the quiz score with the flash card rating

If the user both flipped the card and answered a quiz question about it in the same session:

$$q_{final} = w \cdot q_{quiz} + (1 - w) \cdot q_{self}$$

A good default is $w = 0.7$, because the quiz is more reliable than self-assessment.

**Failure override:** if the quiz answer was wrong, use $q_{final} = \min(q_{quiz}, q_{self})$ instead. This catches overconfidence, where the user rated a card "Easy" but then failed the quiz on it.

If only one source exists, use that score alone.

## 3. Feed it into SM-2

Use $q_{final}$ in place of $q$ in the formulas from before: update the ease factor, reset the card if $q_{final} < 3$, and otherwise grow the interval.

## 4. Code example (JavaScript)

```javascript
function quizToQ({ correct, nearMiss, time, usedHint, type }, tFast = 5, tSlow = 20) {
  if (!correct) return nearMiss ? 2 : 1;
  const T = Math.min(1, Math.max(0, (tSlow - time) / (tSlow - tFast)));
  let q = 3 + 2 * T - (usedHint ? 1 : 0);
  const cap = type === "trueFalse" ? 3 : type === "multipleChoice" ? 4 : 5;
  return Math.max(0, Math.min(cap, q));
}

function combineQ(qQuiz, qSelf, quizCorrect, w = 0.7) {
  if (qQuiz == null) return qSelf;
  if (qSelf == null) return qQuiz;
  if (!quizCorrect) return Math.min(qQuiz, qSelf);
  return Math.round(w * qQuiz + (1 - w) * qSelf);
}

// Usage
const qQuiz = quizToQ({ correct: true, time: 8, usedHint: false, type: "typed" });
const qFinal = combineQ(qQuiz, 5, true);
const updated = reviewCard(card, qFinal); // the SM-2 function from before
```

## 5. Worked examples

| Situation | q_self | q_quiz | q_final | Result |
|---|---|---|---|---|
| Rated "Good", typed correct answer in 8 s | 4 | 4.6 | 4 | Normal interval growth |
| Rated "Easy", multiple-choice correct in 3 s | 5 | 4 (capped) | 4 | Normal growth, guess-proofed |
| Rated "Easy", quiz wrong | 5 | 1 | 1 | Reset to 1 day (overconfidence caught) |
| Rated "Hard", quiz correct but used a hint | 3 | 2.5 | 3 | Passes with a small interval |

## 6. Cards quizzed before their due date

If a quiz covers a card that isn't due yet, a correct answer shouldn't jump the interval as far as an on-time review would. A simple rule is to compute the new interval from the days that actually passed since the last review rather than the scheduled interval:

$$I_{new} = \max\big(I_{current},\ \text{round}(\text{daysElapsed} \times EF')\big)$$

A wrong answer still resets the card as usual, since forgetting early is a real signal.

I can also show how to store these fields in a database table or how to tune $w$ and the time thresholds from real user data.