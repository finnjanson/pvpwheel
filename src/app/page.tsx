import WheelGame from "./components/WheelGame"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "PvP Wheel",
  description: "Мини-игра Telegram",
  manifest: "/manifest.json",
}

export default function HomePage() {
  return <WheelGame />
}
