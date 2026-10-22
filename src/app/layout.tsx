import "./globals.css"
import { openAISans } from "@/lib/openai-sans"
export const metadata = {title:"OriginChain Voice | TNSA",description:"OriginChain realtime voice workspace."}
export default function Layout({children}: {children: React.ReactNode}) {
 return <html lang="en"><body className={`${openAISans.variable} ${openAISans.className} antialiased font-sans`}><main className="flex min-h-svh flex-col gap-4 p-4">{children}</main></body></html>
}
