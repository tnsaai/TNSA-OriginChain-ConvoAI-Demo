/** Canonical order IDs without changing their digits or inventing missing IDs. */
export function normalizeTranscript(text:string){
 return text.replace(/(?<![\p{L}\p{N}_])o\s*c\s*[-–—]?\s*([0-9٠-٩۰-۹]+)(?![\p{L}\p{N}_])/giu,(_,digits:string)=>
  "OC-"+digits.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0)))
}
