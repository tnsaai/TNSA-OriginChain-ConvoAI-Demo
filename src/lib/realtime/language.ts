// Which language the Realtime Voice agent should answer in. Shared by the agent route (source of truth for the model)
// and the client (so speech recognition listens for the same language). Client-safe.

import type { VoiceLang } from "./voices"

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g
const LATIN = /[A-Za-z]/g

/** "ar" when the text is mostly Arabic script, else "en". */
export function scriptLang(text: string): VoiceLang {
  const arabic = (text.match(ARABIC) ?? []).length
  return arabic > 0 && arabic >= (text.match(LATIN) ?? []).length ? "ar" : "en"
}

// "speak Arabic", "reply in arabic", "switch to Arabic please", "can we use Arabic", "بالعربي", "تكلم عربي"
const ASK_ARABIC = /\b(speak|talk|reply|respond|answer|say|use|switch|change|continue|go|in)\b[^.?!]{0,30}\barabic\b|\barabic\s+(please|only|from now)|بالعربي|بالعربية|تكلم عربي|كلمني عربي|باللغة العربية/i
// "speak English", "back to English", "بالانجليزي"
const ASK_ENGLISH = /\b(speak|talk|reply|respond|answer|say|use|switch|change|continue|go|back|in)\b[^.?!]{0,30}\benglish\b|\benglish\s+(please|only|from now)|بالانجليزي|بالإنجليزي|بالانجليزية|بالإنجليزية/i

/** The language the user explicitly asked for in this message, if any. */
export function requestedLang(text: string): VoiceLang | null {
  const ar = ASK_ARABIC.test(text)
  const en = ASK_ENGLISH.test(text)
  if (ar && !en) return "ar"
  if (en && !ar) return "en"
  return null
}

/**
 * Reply language for the next turn:
 * 1. an explicit request ("use Arabic", "speak English") sticks until the user asks for the other language;
 * 2. otherwise follow the script of the latest message (Arabic script means Arabic, anything else English).
 * A message written in Arabic script always gets an Arabic reply.
 */
export function replyLang(userMessages: string[]): VoiceLang {
  const latest = userMessages[userMessages.length - 1] ?? ""
  if (scriptLang(latest) === "ar") return "ar"
  for (let i = userMessages.length - 1; i >= 0; i--) {
    const asked = requestedLang(userMessages[i])
    if (asked) return asked
  }
  return "en"
}
