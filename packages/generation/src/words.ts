/**
 * Words that say nothing about which concept a text is about: articles,
 * prepositions, question words, and the words requests use to ask for a
 * figure. Matching a concept on them would match every concept named with
 * "the", as "the seasons" once matched "the Magnus effect".
 */
export const STOP_WORDS: ReadonlySet<string> = new Set(
  'a an the of to in on for and or with how what why when does do is are be show me explain please can you i my about from by as at that this it its into figure diagram visualise visualize draw make interactive simulation simulate'.split(' '),
);
