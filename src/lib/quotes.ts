// Built-in sports/coaching quotes used to pre-fill a practice plan's quote.
// Kept client-side: ZenQuotes (the obvious API) needs a paid key for both
// keyword filtering and browser (CORS) access, and a local list never fails
// or rate-limits mid-print.
export interface Quote {
  text: string
  author: string
}

export const SPORTS_QUOTES: readonly Quote[] = [
  { text: 'Be quick, but don’t hurry.', author: 'John Wooden' },
  { text: 'Failing to prepare is preparing to fail.', author: 'John Wooden' },
  { text: 'Don’t let what you cannot do interfere with what you can do.', author: 'John Wooden' },
  { text: 'Make each day your masterpiece.', author: 'John Wooden' },
  { text: 'It’s what you learn after you know it all that counts.', author: 'John Wooden' },
  { text: 'Talent wins games, but teamwork and intelligence win championships.', author: 'Michael Jordan' },
  { text: 'Some people want it to happen, some wish it would happen, others make it happen.', author: 'Michael Jordan' },
  { text: 'I can accept failure, everyone fails at something. But I can’t accept not trying.', author: 'Michael Jordan' },
  { text: 'You have to expect things of yourself before you can do them.', author: 'Michael Jordan' },
  { text: 'The strength of the team is each individual member. The strength of each member is the team.', author: 'Phil Jackson' },
  { text: 'Good teams become great ones when the members trust each other enough to surrender the Me for the We.', author: 'Phil Jackson' },
  { text: 'Excellence is the gradual result of always striving to do better.', author: 'Pat Riley' },
  { text: 'Hard work beats talent when talent doesn’t work hard.', author: 'Tim Notke' },
  { text: 'You miss 100% of the shots you don’t take.', author: 'Wayne Gretzky' },
  { text: 'It’s not whether you get knocked down, it’s whether you get up.', author: 'Vince Lombardi' },
  { text: 'Perfection is not attainable, but if we chase perfection we can catch excellence.', author: 'Vince Lombardi' },
  { text: 'Individual commitment to a group effort — that is what makes a team work.', author: 'Vince Lombardi' },
  { text: 'Champions keep playing until they get it right.', author: 'Billie Jean King' },
  { text: 'The more difficult the victory, the greater the happiness in winning.', author: 'Pelé' },
  { text: 'Success is no accident. It is hard work, perseverance, learning, studying, sacrifice and most of all, love of what you are doing.', author: 'Pelé' },
  { text: 'Champions aren’t made in gyms. Champions are made from something they have deep inside them — a desire, a dream, a vision.', author: 'Muhammad Ali' },
  { text: 'Don’t quit. Suffer now and live the rest of your life as a champion.', author: 'Muhammad Ali' },
  { text: 'Everything negative — pressure, challenges — is all an opportunity for me to rise.', author: 'Kobe Bryant' },
  { text: 'One man can be a crucial ingredient on a team, but one man cannot make a team.', author: 'Kareem Abdul-Jabbar' },
  { text: 'Push yourself again and again. Don’t give an inch until the final buzzer sounds.', author: 'Larry Bird' },
  { text: 'It’s not the will to win that matters — everyone has that. It’s the will to prepare to win that matters.', author: 'Paul “Bear” Bryant' },
  { text: 'Don’t give up. Don’t ever give up.', author: 'Jim Valvano' },
  { text: 'A champion is someone who gets up when he can’t.', author: 'Jack Dempsey' },
  { text: 'Gold medals aren’t really made of gold. They’re made of sweat, determination, and a hard-to-find alloy called guts.', author: 'Dan Gable' },
  { text: 'You can’t put a limit on anything. The more you dream, the farther you get.', author: 'Michael Phelps' },
  { text: 'Persistence can change failure into extraordinary achievement.', author: 'Marv Levy' },
  { text: 'Today I will do what others won’t, so tomorrow I can accomplish what others can’t.', author: 'Jerry Rice' },
]

// A random quote, never the one passed in — so "New quote" always visibly changes.
export function randomQuote(exclude?: string | null): Quote {
  const pool = SPORTS_QUOTES.filter((q) => q.text !== exclude)
  return pool[Math.floor(Math.random() * pool.length)]
}
