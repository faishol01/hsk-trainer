// Pool of predefined story themes for the AI story generator.
// The setup screen shows a random subset of these, reshuffled on demand.
export const storyThemes = [
  { emoji: "🥟", label: "Cooking dumplings", value: "Cooking dumplings and Chinese food at home" },
  { emoji: "🚆", label: "Weekend train trip", value: "Weekend trip and train travel to a nearby city" },
  { emoji: "🍵", label: "Tea house & coffee", value: "Visiting a tea house or coffee shop with a friend" },
  { emoji: "🏫", label: "Campus & new friends", value: "Campus life and making new friends" },
  { emoji: "🛒", label: "Supermarket shopping", value: "Shopping for groceries at the supermarket" },
  { emoji: "🧧", label: "Spring Festival", value: "Celebrating Chinese New Year with family" },
  { emoji: "🏥", label: "Seeing a doctor", value: "Feeling sick and visiting the doctor or hospital" },
  { emoji: "🏠", label: "Renting an apartment", value: "Looking for and renting a new apartment" },
  { emoji: "💼", label: "First day at work", value: "The first day at a new job in an office" },
  { emoji: "🎂", label: "Birthday party", value: "Planning a surprise birthday party for a friend" },
  { emoji: "🐱", label: "Lost cat", value: "Looking for a lost cat in the neighborhood" },
  { emoji: "⚽", label: "Sports day", value: "Playing football or basketball after school" },
  { emoji: "🌧️", label: "Rainy day", value: "A rainy day that changes everyone's plans" },
  { emoji: "📚", label: "Library & exams", value: "Studying at the library to prepare for an exam" },
  { emoji: "🚕", label: "Taking a taxi", value: "Taking a taxi and asking for directions in the city" },
  { emoji: "🍜", label: "Ordering at a restaurant", value: "Ordering food at a busy noodle restaurant" },
  { emoji: "🎤", label: "Karaoke night", value: "Singing karaoke (KTV) with classmates" },
  { emoji: "🏔️", label: "Mountain hike", value: "Hiking up a famous mountain on a holiday" },
  { emoji: "🐼", label: "Zoo visit", value: "Visiting the zoo to see pandas" },
  { emoji: "📱", label: "Online shopping", value: "Buying something online and waiting for the delivery" },
  { emoji: "🎬", label: "Movie night", value: "Choosing a movie and going to the cinema" },
  { emoji: "✈️", label: "Airport adventure", value: "Missing a flight and an adventure at the airport" },
  { emoji: "🧑‍🍳", label: "Learning a recipe", value: "Learning to cook a family recipe from grandma" },
  { emoji: "🏮", label: "Mid-Autumn Festival", value: "Eating mooncakes and watching the moon at the Mid-Autumn Festival" },
  { emoji: "🚲", label: "Bike ride in the park", value: "Riding bikes and having a picnic in the park" },
  { emoji: "💇", label: "New haircut", value: "Getting a new haircut that goes wrong" },
  { emoji: "🎨", label: "Hobby class", value: "Joining a calligraphy or painting class" },
  { emoji: "🏖️", label: "Beach holiday", value: "A summer holiday at the beach" },
  { emoji: "👴", label: "Visiting grandparents", value: "Visiting grandparents in the countryside" },
  { emoji: "🎁", label: "Choosing a gift", value: "Choosing the perfect gift for someone special" },
];

/** Returns `count` distinct random themes from the pool (Fisher–Yates shuffle). */
export function pickRandomThemes(count = 5, pool = storyThemes, rng = Math.random) {
  const arr = pool.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(0, Math.min(count, arr.length)));
}
