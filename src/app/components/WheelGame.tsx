"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { useGameDatabase } from "@/hooks/useGameDatabase"
import { useGameState } from "@/hooks/useGameState"
import { Loader2, Gift, PlusCircle, DollarSign } from "lucide-react"

// Helper to format time
const formatTime = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
}

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
}

interface Player {
  id: string
  telegram_user_id: number
  telegram_username?: string
  telegram_first_name: string
  telegram_last_name?: string
  telegram_photo_url?: string
  amount: number
  is_winner?: boolean
}

interface GiftItem {
  id: string
  name: string
  image_url?: string
}

interface WheelGameProps {
  initialGameId?: string
  initialPlayers?: Player[]
  initialGifts?: GiftItem[]
  initialSpinResult?: string
  initialSpinning?: boolean
  initialTimerEnd?: number
  initialGameStatus?: "waiting" | "spinning" | "finished"
}

export default function WheelGame({
  initialGameId,
  initialPlayers = [],
  initialGifts = [],
  initialSpinResult,
  initialSpinning = false,
  initialTimerEnd,
  initialGameStatus = "waiting",
}: WheelGameProps) {
  const {
    gameId,
    players,
    gifts,
    spinResult,
    spinning,
    timerEnd,
    gameStatus,
    setGameId,
    setPlayers,
    setGifts,
    setSpinResult,
    setSpinning,
    setTimerEnd,
    setGameStatus,
  } = useGameState({
    initialGameId,
    initialPlayers,
    initialGifts,
    initialSpinResult,
    initialSpinning,
    initialTimerEnd,
    initialGameStatus,
  })

  const {
    createGame,
    addPlayerToGame,
    addGiftToGame,
    spinWheel,
    getGameDetails,
    updateGameStatus,
    updatePlayerAmount,
  } = useGameDatabase()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [currentAngle, setCurrentAngle] = useState(0)
  const [spinVelocity, setSpinVelocity] = useState(0)
  const [targetAngle, setTargetAngle] = useState(0)
  const [isSpinningAnimation, setIsSpinningAnimation] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [isClient, setIsClient] = useState(false)
  const [telegramUser, setTelegramUser] = useState<TelegramUser | null>(null)

  const handleSpin = useCallback(async () => {
    if (!gameId || players.length === 0 || spinning) return

    setSpinning(true)
    setGameStatus("spinning")
    setSpinResult(undefined)
    setPlayers((prevPlayers) => prevPlayers.map((p) => ({ ...p, is_winner: false })))

    const result = await spinWheel(gameId)
    if (result && result.winner_player_id) {
      const winnerPlayer = players.find((p) => p.id === result.winner_player_id)
      if (winnerPlayer) {
        const finalAngle = Math.random() * 2 * Math.PI // Random angle for animation
        setTargetAngle(finalAngle)
        setSpinVelocity(0.5 + Math.random() * 0.5) // Initial velocity
        setIsSpinningAnimation(true)
      }
    } else {
      setSpinning(false)
      setGameStatus("finished")
      setSpinResult("Не удалось определить победителя.")
    }
  }, [gameId, players, spinning, spinWheel, setSpinning, setGameStatus, setSpinResult, setPlayers])

  useEffect(() => {
    setIsClient(true)
    if (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp) {
      const tg = window.Telegram.WebApp
      tg.ready()
      tg.expand()

      const user = tg.initDataUnsafe?.user
      if (user) {
        setTelegramUser({
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          username: user.username,
          photo_url: user.photo_url,
        })
      }
    }
  }, [])

  const loadTelegramAvatar = useCallback(
    async (userId: number, photoUrl?: string): Promise<HTMLImageElement | null> => {
      if (!photoUrl) return null
      return new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = "anonymous" // Important for CORS when drawing on canvas
        img.src = photoUrl
        img.onload = () => resolve(img)
        img.onerror = () => {
          console.error(`Failed to load avatar for user ${userId} from ${photoUrl}`)
          resolve(null)
        }
      })
    },
    [],
  )

  const drawWheel = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const padding = 20 // Small padding from edges
    const canvasSize = Math.min(window.innerWidth - padding * 2, 600) // Max 600px, or screen width minus padding
    canvas.width = canvasSize
    canvas.height = canvasSize

    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const radius = Math.min(centerX, centerY) * 0.9 // Adjust radius to fit within canvas

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (players.length === 0) {
      ctx.fillStyle = "#f0f0f0"
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI)
      ctx.fill()
      ctx.fillStyle = "#333"
      ctx.font = "20px Arial"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText("Добавьте игроков", centerX, centerY)
      return
    }

    const totalAmount = players.reduce((sum, p) => sum + p.amount, 0)
    let startAngle = currentAngle

    const playerAvatars: { [key: number]: HTMLImageElement | null } = {}
    for (const player of players) {
      if (player.telegram_photo_url) {
        playerAvatars[player.telegram_user_id] = await loadTelegramAvatar(
          player.telegram_user_id,
          player.telegram_photo_url,
        )
      }
    }

    players.forEach((player, index) => {
      const sliceAngle = (player.amount / totalAmount) * 2 * Math.PI
      const endAngle = startAngle + sliceAngle

      ctx.beginPath()
      ctx.moveTo(centerX, centerY)
      ctx.arc(centerX, centerY, radius, startAngle, endAngle)
      ctx.closePath()

      // Alternating colors for slices
      ctx.fillStyle = index % 2 === 0 ? "#FFD700" : "#FFC107" // Gold shades
      ctx.fill()
      ctx.stroke()

      // Draw player name and amount
      const textAngle = startAngle + sliceAngle / 2
      const textRadius = radius * 0.7
      const textX = centerX + Math.cos(textAngle) * textRadius
      const textY = centerY + Math.sin(textAngle) * textRadius

      ctx.save()
      ctx.translate(textX, textY)
      ctx.rotate(textAngle + Math.PI / 2) // Rotate text to be readable
      ctx.fillStyle = "#333"
      ctx.font = "14px Arial"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(`${player.telegram_first_name} (${player.amount})`, 0, 0)

      // Draw avatar if available
      const avatar = playerAvatars[player.telegram_user_id]
      if (avatar) {
        const avatarSize = 30 // Size of the avatar
        ctx.drawImage(avatar, -avatarSize / 2, -avatarSize - 15, avatarSize, avatarSize) // Position above text
      }
      ctx.restore()

      startAngle = endAngle
    })

    // Draw the pointer
    ctx.fillStyle = "red"
    ctx.beginPath()
    ctx.moveTo(centerX + radius + 10, centerY)
    ctx.lineTo(centerX + radius - 10, centerY - 10)
    ctx.lineTo(centerX + radius - 10, centerY + 10)
    ctx.closePath()
    ctx.fill()

    // Draw center circle
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius * 0.1, 0, 2 * Math.PI)
    ctx.fillStyle = "#fff"
    ctx.fill()
    ctx.stroke()
  }, [players, currentAngle, loadTelegramAvatar])

  useEffect(() => {
    drawWheel()
  }, [drawWheel])

  useEffect(() => {
    let animationFrameId: number
    if (isSpinningAnimation) {
      const animateSpin = () => {
        setCurrentAngle((prevAngle) => (prevAngle + spinVelocity) % (2 * Math.PI))
        setSpinVelocity((prevVelocity) => prevVelocity * 0.98) // Decelerate
        if (spinVelocity < 0.001 && Math.abs(currentAngle - targetAngle) < 0.01) {
          setIsSpinningAnimation(false)
          setSpinning(false)
          cancelAnimationFrame(animationFrameId)
          // Determine winner based on final angle
          const normalizedAngle = (currentAngle + 2 * Math.PI) % (2 * Math.PI)
          const totalAmount = players.reduce((sum, p) => sum + p.amount, 0)
          let startAngle = 0
          let winner: Player | undefined
          for (const player of players) {
            const sliceAngle = (player.amount / totalAmount) * 2 * Math.PI
            const endAngle = startAngle + sliceAngle
            if (normalizedAngle >= startAngle && normalizedAngle < endAngle) {
              winner = player
              break
            }
            startAngle = endAngle
          }
          if (winner) {
            setSpinResult(winner.telegram_first_name)
            setPlayers((prevPlayers) =>
              prevPlayers.map((p) => (p.id === winner?.id ? { ...p, is_winner: true } : { ...p, is_winner: false })),
            )
            updateGameStatus(gameId!, "finished")
          }
        } else {
          animationFrameId = requestAnimationFrame(animateSpin)
        }
      }
      animationFrameId = requestAnimationFrame(animateSpin)
    }
    return () => cancelAnimationFrame(animationFrameId)
  }, [
    isSpinningAnimation,
    spinVelocity,
    currentAngle,
    targetAngle,
    players,
    setSpinning,
    setSpinResult,
    gameId,
    updateGameStatus,
    setPlayers,
  ])

  useEffect(() => {
    let timerInterval: NodeJS.Timeout | undefined
    if (gameStatus === "waiting" && timerEnd) {
      timerInterval = setInterval(() => {
        const now = Date.now()
        const remaining = timerEnd - now
        if (remaining <= 0) {
          setTimeRemaining(0)
          clearInterval(timerInterval!)
          // Auto-spin if timer runs out
          if (players.length > 0) {
            handleSpin()
          } else {
            setGameStatus("finished") // Or reset, if no players
          }
        } else {
          setTimeRemaining(remaining)
        }
      }, 1000)
    }
    return () => clearInterval(timerInterval!)
  }, [gameStatus, timerEnd, players.length, handleSpin])

  const handleCreateGame = useCallback(async () => {
    if (!telegramUser) return
    const newGame = await createGame(telegramUser.id, telegramUser.username || telegramUser.first_name)
    if (newGame) {
      setGameId(newGame.id)
      setPlayers([])
      setGifts([])
      setSpinResult(undefined)
      setSpinning(false)
      setTimerEnd(Date.now() + 60 * 1000) // 60 seconds timer
      setGameStatus("waiting")
    }
  }, [
    createGame,
    setGameId,
    setPlayers,
    setGifts,
    setSpinResult,
    setSpinning,
    setTimerEnd,
    setGameStatus,
    telegramUser,
  ])

  const handleJoinGame = useCallback(
    async (amount: number) => {
      if (!gameId || !telegramUser) return
      const updatedPlayer = await addPlayerToGame(
        gameId,
        telegramUser.id,
        telegramUser.username || telegramUser.first_name,
        telegramUser.photo_url,
        amount,
      )
      if (updatedPlayer) {
        const existingPlayerIndex = players.findIndex((p) => p.id === updatedPlayer.id)
        if (existingPlayerIndex > -1) {
          setPlayers((prev) => prev.map((p) => (p.id === updatedPlayer.id ? updatedPlayer : p)))
        } else {
          setPlayers((prev) => [...prev, updatedPlayer])
        }
      }
    },
    [gameId, addPlayerToGame, players, setPlayers, telegramUser],
  )

  const handleAddGift = useCallback(
    async (name: string) => {
      if (!gameId) return
      const newGift = await addGiftToGame(gameId, name)
      if (newGift) {
        setGifts((prev) => [...prev, newGift])
      }
    },
    [gameId, addGiftToGame, setGifts],
  )

  const handleRefreshGame = useCallback(async () => {
    if (!gameId) return
    const details = await getGameDetails(gameId)
    if (details) {
      setPlayers(details.players || [])
      setGifts(details.gifts || [])
      setSpinResult(details.spin_result || undefined)
      setSpinning(details.status === "spinning")
      setTimerEnd(details.timer_end ? new Date(details.timer_end).getTime() : undefined)
      setGameStatus(details.status || "waiting")
    }
  }, [gameId, getGameDetails, setPlayers, setGifts, setSpinResult, setSpinning, setTimerEnd, setGameStatus])

  if (!isClient) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-50">
      <header className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 shadow-sm">
        <h1 className="text-2xl font-bold">PvP Колесо</h1>
        {gameId && (
          <Button variant="outline" onClick={handleRefreshGame}>
            Обновить игру
          </Button>
        )}
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4 space-y-4 overflow-auto">
        {!gameId && (
          <Card className="w-full max-w-md">
            <CardContent className="p-6 text-center">
              <h2 className="text-xl font-semibold mb-4">Начать новую игру</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Создайте новую игру, чтобы начать вращать колесо и выигрывать призы!
              </p>
              <Button onClick={handleCreateGame} className="w-full">
                Создать игру
              </Button>
            </CardContent>
          </Card>
        )}

        {gameId && (
          <>
            <Card className="w-full max-w-md">
              <CardContent className="p-6">
                <h2 className="text-xl font-semibold mb-4">ID Игры: {gameId}</h2>
                <div className="flex justify-center mb-4">
                  <canvas
                    ref={canvasRef}
                    className="border border-gray-300 dark:border-gray-700 rounded-full shadow-lg"
                  ></canvas>
                </div>

                {gameStatus === "waiting" && timerEnd && (
                  <div className="text-center mb-4">
                    <p className="text-lg font-medium">Время до старта: {formatTime(timeRemaining)}</p>
                    <Progress value={(timeRemaining / (60 * 1000)) * 100} className="w-full mt-2" />
                  </div>
                )}

                {gameStatus === "spinning" && (
                  <div className="text-center mb-4">
                    <p className="text-lg font-medium">Колесо крутится...</p>
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mt-2" />
                  </div>
                )}

                {gameStatus === "finished" && spinResult && (
                  <div className="text-center mb-4">
                    <h3 className="text-2xl font-bold text-green-600">Победитель: {spinResult}!</h3>
                    <Button
                      onClick={() => {
                        setGameId(undefined)
                        setPlayers([])
                        setGifts([])
                        setSpinResult(undefined)
                        setSpinning(false)
                        setTimerEnd(undefined)
                        setGameStatus("waiting")
                      }}
                      className="mt-4"
                    >
                      Начать новую игру
                    </Button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 mt-4">
                  <Button
                    onClick={() => handleJoinGame(10)}
                    disabled={gameStatus !== "waiting" || spinning}
                    className="px-8 py-4 text-lg"
                  >
                    <PlusCircle className="mr-2 h-5 w-5" /> Добавить TON
                  </Button>
                  <Button
                    onClick={() => handleAddGift("Новый подарок")}
                    disabled={gameStatus !== "waiting" || spinning}
                    className="px-8 py-4 text-lg"
                  >
                    <Gift className="mr-2 h-5 w-5" /> Добавить подарок
                  </Button>
                </div>

                {gameStatus === "waiting" && players.length > 0 && (
                  <Button onClick={handleSpin} disabled={spinning} className="w-full mt-4">
                    {spinning ? "Крутится..." : "Крутить колесо"}
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="w-full max-w-md">
              <CardContent className="p-6">
                <h2 className="text-xl font-semibold mb-4">Игроки ({players.length})</h2>
                {players.length === 0 ? (
                  <p className="text-gray-600 dark:text-gray-400">Пока нет игроков. Присоединяйтесь!</p>
                ) : (
                  <div className="space-y-3">
                    {players.map((player) => (
                      <div
                        key={player.id}
                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md"
                      >
                        <div className="flex items-center space-x-3">
                          <Avatar>
                            <AvatarImage
                              src={player.telegram_photo_url || "/anonymous-user-concept.png"}
                              alt={`${player.telegram_first_name}'s avatar`}
                            />
                            <AvatarFallback>{player.telegram_first_name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">
                              {player.telegram_first_name} {player.telegram_last_name}
                            </p>
                            {player.telegram_username && (
                              <p className="text-sm text-gray-500 dark:text-gray-400">@{player.telegram_username}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-lg">{player.amount} TON</span>
                          {player.is_winner && (
                            <span className="text-green-500 text-sm font-semibold">Победитель!</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="w-full max-w-md">
              <CardContent className="p-6">
                <h2 className="text-xl font-semibold mb-4">Подарки ({gifts.length})</h2>
                {gifts.length === 0 ? (
                  <p className="text-gray-600 dark:text-gray-400">Пока нет подарков.</p>
                ) : (
                  <div className="space-y-3">
                    {gifts.map((gift) => (
                      <div
                        key={gift.id}
                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md"
                      >
                        <div className="flex items-center space-x-3">
                          <Gift className="h-5 w-5 text-gray-500" />
                          <p className="font-medium">{gift.name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 shadow-lg p-4 flex justify-around items-center border-t border-gray-200 dark:border-gray-700 z-10">
        <a
          href="https://t.me/grinchroll_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
        >
          <DollarSign className="h-6 w-6 mb-1" />
          <span>PVP</span>
        </a>
        <a
          href="https://t.me/grinchroll_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
        >
          <Gift className="h-6 w-6 mb-1" />
          <span>Мои подарки</span>
        </a>
        <a
          href="https://t.me/grinchroll_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
        >
          <PlusCircle className="h-6 w-6 mb-1" />
          <span>Заработать</span>
        </a>
      </footer>
    </div>
  )
}
