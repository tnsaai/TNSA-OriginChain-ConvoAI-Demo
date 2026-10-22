import localFont from "next/font/local"

export const openAISans = localFont({
  variable: "--font-openai-sans",
  display: "swap",
  src: [
    {
      path: "../../fonts/OpenAISans-Light.ttf",
      weight: "300",
      style: "normal",
    },
    {
      path: "../../fonts/OpenAISans-LightItalic.ttf",
      weight: "300",
      style: "italic",
    },
    {
      path: "../../fonts/OpenAISans-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../fonts/OpenAISans-RegularItalic.ttf",
      weight: "400",
      style: "italic",
    },
    {
      path: "../../fonts/OpenAISans-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../fonts/OpenAISans-MediumItalic.ttf",
      weight: "500",
      style: "italic",
    },
    {
      path: "../../fonts/OpenAISans-Semibold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../fonts/OpenAISans-SemiboldItalic.ttf",
      weight: "600",
      style: "italic",
    },
    {
      path: "../../fonts/OpenAISans-Bold.ttf",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../fonts/OpenAISans-BoldItalic.ttf",
      weight: "700",
      style: "italic",
    },
  ],
})
