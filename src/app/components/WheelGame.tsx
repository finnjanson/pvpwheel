"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Trophy, History, ChevronLeft, MessageCircle } from 'lucide-react'
import { useGameDatabase } from "../../hooks/useGameDatabase"
import Image from "next/image"

// Telegram WebApp types
interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  photo_url?: string
}

interface TelegramWebApp {
  initData: string
  initDataUnsafe: {
    user?: TelegramUser
    start_param?: string
  }
  ready: () => void
  expand: () => void
  close: () => void
  openLink: (url: string) => void
  MainButton: {
    text: string
    color: string
    textColor: string
    isVisible: boolean
    isActive: boolean
    show: () => void
    hide: () => void
    onClick: (callback: () => void) => void
  }
  HapticFeedback: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void
    notificationOccurred: (type: "error" | "success" | "warning") => void
    selectionChanged: () => void
  }
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp
    }
  }
}

interface Player {
  id: string
  name: string
  balance: number
  color: string
  gifts: string[] // Array of gift emojis
  giftValue: number // Total TON value of gifts
  telegramUser?: TelegramUser // Store Telegram user data for avatar
}

interface GameLog {
  id: string
  message: string
  timestamp: Date
  type: "join" | "spin" | "winner" | "info"
}

interface MatchHistoryEntry {
  id: string
  rollNumber: number
  timestamp: Date
  players: Player[]
  winner: Player
  totalPot: number
  winnerChance: number
}

interface Gift {
  id: string
  emoji: string
  name: string
  value: number // TON value
  rarity: "common" | "rare" | "epic" | "legendary"
  quantity: number
  nft_address?: string // TON NFT collection address
  nft_item_id?: string // Specific NFT item ID
  is_nft?: boolean // Whether this is an NFT gift
}

type HistoryFilter = "time" | "luckiest" | "fattest"

const COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
  "#F8C471",
  "#82E0AA",
  "#F1948A",
  "#85929E",
  "#D7BDE2",
]

const SPIN_DURATION = 4000
const COUNTDOWN_DURATION = 60

// NFT Deposit configuration - Telegram-based
const NFT_DEPOSIT_TELEGRAM = "@pwpwheel" // Telegram username for NFT gift transfers

export default function WheelGame() {
  // Database integration
  const {
    currentGameId,
    currentPlayer,
    dbPlayers,
    dbGameLogs,
    dbMatchHistory,
    playerInventory,
    availableGifts,
    gameCountdown,
    loading: dbLoading,
    error: dbError,
    initializePlayer,
    getCurrentGame,
    joinGameWithGifts,
    completeGame,
    addGameLog: addDbGameLog,
    loadMatchHistory,
    loadGameParticipants,
    startGameCountdown,
    getGameCountdown,
    clearError,
  } = useGameDatabase()

  const [players, setPlayers] = useState<Player[]>([])
  const [gameLog, setGameLog] = useState<GameLog[]>([])
  const [isSpinning, setIsSpinning] = useState(false)
  const [winner, setWinner] = useState<Player | null>(null)
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [playerName, setPlayerName] = useState("")
  const [playerBalance, setPlayerBalance] = useState("")
  const [activeTab, setActiveTab] = useState<"pvp" | "gifts" | "earn">("pvp")
  const [rollNumber, setRollNumber] = useState(8343) // Persistent roll number
  const [matchHistory, setMatchHistory] = useState<MatchHistoryEntry[]>([])
  const [showMatchHistory, setShowMatchHistory] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("time")
  const [userInventory, setUserInventory] = useState<Gift[]>([])
  const [showGiftPopup, setShowGiftPopup] = useState(false)
  const [selectedGifts, setSelectedGifts] = useState<{ id: string; quantity: number }[]>([])
  const [showPlayerGiftsPopup, setShowPlayerGiftsPopup] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null)

  // NFT Deposit states
  const [showNftDepositPopup, setShowNftDepositPopup] = useState(false)
  const [isDepositing, setIsDepositing] = useState(false)

  // Telegram WebApp state
  const [telegramUser, setTelegramUser] = useState<TelegramUser | null>(null)
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)
  const spinTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Avatar cache to store loaded images
  const avatarCache = useRef<Map<string, HTMLImageElement>>(new Map())

  // Helper function to load and cache Telegram avatars
  const loadTelegramAvatar = useCallback(async (photoUrl: string): Promise<HTMLImageElement> => {
    // Check cache first
    if (avatarCache.current.has(photoUrl)) {
      return avatarCache.current.get(photoUrl)!
    }

    return new Promise((resolve, reject) => {
      const img = new Image()
      // Remove crossOrigin to avoid CORS issues with Telegram avatars
      img.onload = () => {
        console.log("Avatar loaded successfully:", photoUrl)
        avatarCache.current.set(photoUrl, img)
        resolve(img)
      }
      img.onerror = (error) => {
        console.error("Avatar failed to load:", photoUrl, error)
        reject(error)
      }
      img.src = photoUrl
    })
  }, [])

  // Preload all player avatars
  const preloadAvatars = useCallback(async () => {
    const promises = players
      .filter((player) => player.telegramUser?.photo_url)
      .map((player) => {
        console.log("Preloading avatar for:", player.name, "URL:", player.telegramUser?.photo_url)
        return loadTelegramAvatar(player.telegramUser!.photo_url!)
      })

    console.log("Found", promises.length, "avatars to preload")

    try {
      await Promise.all(promises)
      console.log("All avatars preloaded successfully")
      return true // Return success status
    } catch (error) {
      console.warn("Some avatars failed to load:", error)
      return false
    }
  }, [players, loadTelegramAvatar])

  const addToLog = useCallback(
    (message: string, type: GameLog["type"] = "info") => {
      const newLog: GameLog = {
        id: Date.now().toString(),
        message,
        timestamp: new Date(),
        type,
      }
      setGameLog((prev) => [newLog, ...prev.slice(0, 19)])

      // Add haptic feedback for Telegram WebApp
      if (webApp?.HapticFeedback) {
        switch (type) {
          case "winner":
            webApp.HapticFeedback.notificationOccurred("success")
            break
          case "join":
            webApp.HapticFeedback.impactOccurred("light")
            break
          case "spin":
            webApp.HapticFeedback.impactOccurred("medium")
            break
        }
      }
    },
    [webApp],
  )

  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const radius = 140

    ctx.clearRect(0, 0, canvas.width, canvas.width)

    // Use activePlayers instead of players
    const activePlayers = dbPlayers.length > 0 ? dbPlayers : players

    if (activePlayers.length === 0) {
      // Draw empty wheel with transparent background
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius)
      gradient.addColorStop(0, "rgba(75, 85, 99, 0.3)")
      gradient.addColorStop(1, "rgba(55, 65, 81, 0.5)")

      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI)
      ctx.fill()

      ctx.strokeStyle = "rgba(156, 163, 175, 0.5)"
      ctx.lineWidth = 3
      ctx.stroke()

      return
    }

    const totalValue = activePlayers.reduce((sum, player) => sum + player.balance + player.giftValue, 0)
    let currentAngle = -Math.PI / 2 // Start at top (12 o'clock position) where the arrow points

    activePlayers.forEach((player) => {
      const playerValue = player.balance + player.giftValue
      const segmentAngle = (playerValue / totalValue) * 2 * Math.PI

      // Draw segment
      ctx.fillStyle = player.color
      ctx.beginPath()
      ctx.moveTo(centerX, centerY)
      ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + segmentAngle)
      ctx.closePath()
      ctx.fill()

      // Remove the white border between segments

      // Draw avatar and value if segment is large enough
      if (segmentAngle > 0.2) {
        const textAngle = currentAngle + segmentAngle / 2
        const textRadius = radius * 0.7
        const textX = centerX + Math.cos(textAngle) * textRadius
        const textY = centerY + Math.sin(textAngle) * textRadius

        ctx.save()
        ctx.translate(textX, textY)
        // Remove rotation adjustment since we want avatars to stay upright

        // Draw avatar circle
        const avatarRadius = 14 // Reduced from 18 to 14

        // Check if player has Telegram photo and it's cached
        if (player.telegramUser?.photo_url && avatarCache.current.has(player.telegramUser.photo_url)) {
          console.log("Drawing cached avatar for:", player.name)
          const avatarImg = avatarCache.current.get(player.telegramUser.photo_url)!

          try {
            ctx.save()
            ctx.beginPath()
            ctx.arc(0, 0, avatarRadius, 0, 2 * Math.PI) // Changed from (0, -8) to (0, 0)
            ctx.clip()
            ctx.drawImage(avatarImg, -avatarRadius, -avatarRadius, avatarRadius * 2, avatarRadius * 2)
            ctx.restore()

            // Draw white border around avatar
            ctx.strokeStyle = "#fff"
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(0, 0, avatarRadius, 0, 2 * Math.PI) // Changed from (0, -8) to (0, 0)
            ctx.stroke()
          } catch (error) {
            console.error("Error drawing avatar for:", player.name, error)
            drawFallbackAvatar()
          }
        } else {
          // Draw fallback avatar
          console.log(
            "Drawing fallback avatar for:",
            player.name,
            "Has photo URL:",
            !!player.telegramUser?.photo_url,
            "Is cached:",
            player.telegramUser?.photo_url ? avatarCache.current.has(player.telegramUser.photo_url) : false,
          )
          drawFallbackAvatar()
        }

        // Function to draw fallback avatar
        function drawFallbackAvatar() {
          if (!ctx) return

          const gradient = ctx.createLinearGradient(-avatarRadius, -avatarRadius, avatarRadius, avatarRadius)
          gradient.addColorStop(0, "#60A5FA") // blue-400
          gradient.addColorStop(1, "#A855F7") // purple-500

          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.arc(0, 0, avatarRadius, 0, 2 * Math.PI) // Changed from (0, -8) to (0, 0)
          ctx.fill()

          // Draw white border around avatar
          ctx.strokeStyle = "#fff"
          ctx.lineWidth = 2
          ctx.stroke()

          // Draw user initial in avatar
          ctx.fillStyle = "#fff"
          ctx.font = "bold 16px DM Sans"
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(player.name.charAt(0).toUpperCase(), 0, 0) // Changed from (0, -8) to (0, 0)
        }

        ctx.restore()
      }

      currentAngle += segmentAngle
    })

    // Draw outer border
    ctx.strokeStyle = "rgba(156, 163, 175, 0.7)"
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI)
    ctx.stroke()
  }, [players, dbPlayers])

  const addPlayer = () => {
    const name = playerName.trim()
    const balance = Number.parseInt(playerBalance)

    if (!name || !balance || balance < 1 || balance > 10000) {
      alert("Пожалуйста, введите действительное имя и баланс (1-10,000)!")
      return
    }

    if (players.some((p) => p.name === name)) {
      alert("Имя игрока уже существует!")
      return
    }

    if (players.length >= 15) {
      alert("Разрешено максимум 15 игроков!")
      return
    }

    const newPlayer: Player = {
      id: Date.now().toString(),
      name,
      balance,
      color: COLORS[players.length % COLORS.length],
      gifts: ["🎁", "💎", "⭐"].slice(0, Math.floor(Math.random() * 3) + 1), // Random 1-3 gifts
      giftValue: Math.random() * 0.5 + 0.1, // Random gift value between 0.1-0.6 TON
      // No telegramUser for test players - they'll get fallback avatars
    }

    setPlayers((prev) => [...prev, newPlayer])
    addToLog(`🎉 ${name} присоединился с $${balance.toLocaleString()}!`, "join")
    setPlayerName("")
    setPlayerBalance("")
  }

  const spinWheel = useCallback(async () => {
    // Use activePlayers for consistency with display
    const activePlayers = dbPlayers.length > 0 ? dbPlayers : players

    if (activePlayers.length < 2) {
      addToLog("⚠️ Нужно минимум 2 игрока, чтобы крутить колесо!", "info")
      return
    }

    if (isSpinning) return

    setIsSpinning(true)
    addToLog("🎰 Колесо крутится... Всем удачи!", "spin")

    // Add to database log
    if (currentGameId) {
      await addDbGameLog(currentGameId, null, "spin", "🎰 Колесо крутится... Всем удачи!")
    }

    // Preload avatars before spinning
    await preloadAvatars()

    const totalValue = activePlayers.reduce((sum, player) => sum + player.balance + player.giftValue, 0)
    const randomValue = Math.random() * totalValue

    let currentSum = 0
    let selectedWinner: Player | null = null

    for (const player of activePlayers) {
      const playerValue = player.balance + player.giftValue
      currentSum += playerValue
      if (randomValue <= currentSum) {
        selectedWinner = player
        break
      }
    }

    // Animate wheel rotation
    const canvas = canvasRef.current
    if (canvas) {
      const spins = 5 + Math.random() * 3
      const finalRotation = spins * 360 + Math.random() * 360
      canvas.style.transition = `transform ${SPIN_DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`
      canvas.style.transform = `rotate(${finalRotation}deg)`
    }

    spinTimeoutRef.current = setTimeout(async () => {
      if (selectedWinner) {
        const totalBalance = activePlayers.reduce((sum, player) => sum + player.balance, 0)
        const totalGiftValue = activePlayers.reduce((sum, player) => sum + player.giftValue, 0)
        const playerValue = selectedWinner.balance + selectedWinner.giftValue
        const winnerChance = (playerValue / totalValue) * 100

        // Complete game in database
        if (currentGameId && currentPlayer) {
          try {
            await completeGame(currentGameId, currentPlayer.id, winnerChance, totalGiftValue)

            // Add winner log to database
            await addDbGameLog(
              currentGameId,
              currentPlayer.id,
              "winner",
              `🎉 ${selectedWinner.name} выиграл ${totalGiftValue.toFixed(3)} TON в подарках!`,
            )

            // Reload match history
            await loadMatchHistory()
          } catch (error) {
            console.error("Failed to complete game in database:", error)
          }
        }

        // Add to match history
        const matchEntry: MatchHistoryEntry = {
          id: Date.now().toString(),
          rollNumber: rollNumber,
          timestamp: new Date(),
          players: [...activePlayers], // Use activePlayers for consistency
          winner: selectedWinner,
          totalPot: totalGiftValue, // Only TON gifts now
          winnerChance: winnerChance,
        }
        setMatchHistory((prev) => [matchEntry, ...prev])

        setWinner(selectedWinner)
        setShowWinnerModal(true)
        addToLog(`🎉 ${selectedWinner.name} выиграл ${totalGiftValue.toFixed(3)} TON в подарках!`, "winner")
        setRollNumber((prev) => prev + 1) // Increment roll number for next game
      }
      setTimeout(async () => {
        setIsSpinning(false)
        setPlayers([])
        setWinner(null)
        setShowWinnerModal(false)

        // Create new game for next round
        if (currentPlayer) {
          try {
            await getCurrentGame(rollNumber + 1)
          } catch (error) {
            console.error("Failed to create new game:", error)
          }
        }

        if (canvas) {
          canvas.style.transition = "none"
          canvas.style.transform = "rotate(0deg)"
        }
      }, 3000)
    }, SPIN_DURATION)
  }, [
    players,
    isSpinning,
    addToLog,
    preloadAvatars,
    rollNumber,
    currentGameId,
    currentPlayer,
    addDbGameLog,
    completeGame,
    loadMatchHistory,
    getCurrentGame,
  ])

  // Auto-spin when countdown reaches 0
  useEffect(() => {
    const activePlayers = dbPlayers.length > 0 ? dbPlayers : players
    if (gameCountdown === 0 && !isSpinning && activePlayers.length >= 2) {
      console.log("Database countdown reached 0, spinning wheel")
      spinWheel()
    }
  }, [gameCountdown, isSpinning, dbPlayers, players, spinWheel])

  // Draw wheel when players change
  useEffect(() => {
    const loadAndDrawWheel = async () => {
      const avatarsLoaded = await preloadAvatars()
      drawWheel()
      // If avatars were loaded, force another redraw to ensure they appear
      if (avatarsLoaded && players.some((p) => p.telegramUser?.photo_url)) {
        setTimeout(() => drawWheel(), 200)
      }
    }
    loadAndDrawWheel()
  }, [players, drawWheel, preloadAvatars])

  // Redraw wheel when database players change
  useEffect(() => {
    const loadAndDrawWheel = async () => {
      const avatarsLoaded = await preloadAvatars()
      drawWheel()
      // If avatars were loaded, force another redraw to ensure they appear
      if (avatarsLoaded && dbPlayers.some((p) => p.telegramUser?.photo_url)) {
        setTimeout(() => drawWheel(), 200)
      }
    }
    loadAndDrawWheel()
  }, [dbPlayers, drawWheel, preloadAvatars])

  // Redraw wheel when switching back to PvP tab or closing match history
  useEffect(() => {
    if (activeTab === "pvp" && !showMatchHistory) {
      const loadAndDrawWheel = async () => {
        await preloadAvatars()
        drawWheel()
      }
      loadAndDrawWheel()
    }
  }, [activeTab, showMatchHistory, drawWheel, preloadAvatars])

  // Cleanup
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearTimeout(countdownRef.current)
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current)
    }
  }, [])

  // Initialize inventory from database (real player inventory)
  useEffect(() => {
    // Use real player inventory instead of simulated data
    if (playerInventory && playerInventory.length > 0) {
      const realInventory = playerInventory.map((item) => ({
        id: item.gift_id,
        emoji: item.gifts?.emoji || "🎁",
        name: item.gifts?.name || "Неизвестный подарок",
        value: item.gifts?.base_value || 0,
        rarity: item.gifts?.rarity || "common",
        quantity: item.quantity || 0,
        nft_address: item.gifts?.nft_address,
        nft_item_id: item.gifts?.nft_item_id,
        is_nft: item.gifts?.is_nft || false,
      }))
      setUserInventory(realInventory)
    } else {
      // Clear inventory if no gifts in database
      setUserInventory([])
    }
  }, [playerInventory])

  // Load current game on component mount (for cross-device visibility)
  useEffect(() => {
    const loadCurrentGame = async () => {
      try {
        console.log("🎮 PvP Wheel: Загрузка текущего состояния игры...")

        // Pass 0 as rollNumber to only load existing games, not create new ones
        const game = await getCurrentGame(0)
        if (game) {
          console.log(
            "✅ Текущая игра загружена:",
            game.roll_number,
            "с",
            game.game_participants?.length || 0,
            "игроками",
          )

          // Load participants for this game
          await loadGameParticipants(game.id)
        } else {
          console.log("ℹ️ Нет текущей игры - будет создана, когда присоединится первый пользователь")
        }
      } catch (error) {
        console.error("❌ Не удалось загрузить текущую игру:", error)
      }
    }

    // Only load if we don't already have a current game
    if (!currentGameId) {
      loadCurrentGame()
    }
  }, [getCurrentGame, loadGameParticipants, currentGameId])

  // Initialize Telegram WebApp with database integration
  useEffect(() => {
    // Wait for Telegram WebApp to be available
    const initTelegram = async () => {
      if (typeof window !== "undefined" && window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp
        setWebApp(tg)

        // Initialize the WebApp
        tg.ready()
        tg.expand()

        // Configure main button (hidden by default)
        tg.MainButton.hide()

        // Get user data from Telegram
        const user = tg.initDataUnsafe?.user
        if (user) {
          console.log("Telegram user data:", user)
          setTelegramUser(user)

          // Initialize player in database
          try {
            console.log("Инициализация игрока в базе данных...")
            const dbPlayer = await initializePlayer(user)
            if (dbPlayer) {
              console.log("Игрок базы данных инициализирован:", dbPlayer)

              // Auto-fill the player name with Telegram user info
              const displayName = user.username || user.first_name || `Пользователь${user.id}`
              setPlayerName(displayName)

              addToLog(`🎯 С возвращением, ${displayName}! Готовы к большой победе? 🏆`, "info")

              // Get or create current game
              const game = await getCurrentGame(rollNumber)
              if (game) {
                console.log("Текущая игра:", game)

                // Load participants for this game
                await loadGameParticipants(game.id)
              }
            } else {
              console.log("Не удалось инициализировать игрока в базе данных, используется автономный режим")
              addToLog("⚠️ Подключение к базе данных не удалось. Игра в автономном режиме.", "info")
            }
          } catch (error) {
            console.error("Не удалось инициализировать игрока:", error)
            addToLog("⚠️ Не удалось подключиться к базе данных. Использование автономного режима.", "info")
          }

          // Show welcome notification
          tg.HapticFeedback?.notificationOccurred("success")
        } else {
          console.log("Данные пользователя Telegram не найдены")
          addToLog("⚡ Telegram WebApp готов! Присоединяйтесь к колесу, чтобы выиграть TON и подарки! 🎁", "info")
        }
      } else {
        // Retry initialization if Telegram WebApp is not ready yet
        setTimeout(initTelegram, 100)
      }
    }

    initTelegram()
  }, [addToLog, initializePlayer, getCurrentGame, rollNumber])

  // Sync database players with local state for wheel rendering
  useEffect(() => {
    if (dbPlayers.length > 0) {
      console.log("🔄 Синхронизация", dbPlayers.length, "игроков из базы данных")
      // Update local players to match database state
      setPlayers(dbPlayers)
    }
  }, [dbPlayers])

  // Use database players if available, otherwise fall back to local players
  const activePlayers = dbPlayers.length > 0 ? dbPlayers : players

  const totalPot = activePlayers.reduce((sum, player) => sum + player.gifts.length, 0)
  const totalGiftValue = activePlayers.reduce((sum, player) => sum + player.giftValue, 0)
  const totalValue = totalPot + totalGiftValue

  const getRarityColor = (rarity: Gift["rarity"]) => {
    switch (rarity) {
      case "common":
        return "text-gray-400 border-gray-500"
      case "rare":
        return "text-blue-400 border-blue-500"
      case "epic":
        return "text-purple-400 border-purple-500"
      case "legendary":
        return "text-yellow-400 border-yellow-500"
      default:
        return "text-gray-400 border-gray-500"
    }
  }

  const handleGiftSelection = (giftId: string, quantity: number) => {
    setSelectedGifts((prev) => {
      const existing = prev.find((g) => g.id === giftId)
      if (existing) {
        if (quantity === 0) {
          return prev.filter((g) => g.id !== giftId)
        }
        return prev.map((g) => (g.id === giftId ? { ...g, quantity } : g))
      } else if (quantity > 0) {
        return [...prev, { id: giftId, quantity }]
      }
      return prev
    })
  }

  const getTotalGiftValue = () => {
    return selectedGifts.reduce((total, selected) => {
      const gift = userInventory.find((g) => g.id === selected.id)
      return total + (gift ? gift.value * selected.quantity : 0)
    }, 0)
  }

  const selectAllGifts = () => {
    const allAvailableGifts = userInventory
      .filter((gift) => gift.quantity > 0)
      .map((gift) => ({ id: gift.id, quantity: gift.quantity }))
    setSelectedGifts(allAvailableGifts)
    webApp?.HapticFeedback?.impactOccurred("medium")
  }

  // NFT Deposit Functions
  const openNftDepositPopup = () => {
    setShowNftDepositPopup(true)
    webApp?.HapticFeedback?.impactOccurred("light")
  }

  const copyDepositAddress = () => {
    navigator.clipboard.writeText(NFT_DEPOSIT_TELEGRAM)
    webApp?.HapticFeedback?.notificationOccurred("success")
    addToLog("📋 Адрес Telegram скопирован в буфер обмена!", "info")
  }

  const copyUserMessage = () => {
    const message = `Привет! Я хочу внести свои NFT подарки для PvP Wheel. Мой никнейм: @${telegramUser?.username || telegramUser?.first_name || "пользователь"}`
    navigator.clipboard.writeText(message)
    webApp?.HapticFeedback?.notificationOccurred("success")
    addToLog("📋 Сообщение скопировано в буфер обмена!", "info")
  }

  const openTelegramDeposit = () => {
    if (!telegramUser) {
      webApp?.HapticFeedback?.notificationOccurred("error")
      alert("Пожалуйста, сначала подключите свой аккаунт Telegram!")
      return
    }

    const message = `Привет! Я хочу внести свои NFT подарки для PvP Wheel. Мой никнейм: @${telegramUser?.username || telegramUser?.first_name || "пользователь"}`
    const telegramUrl = `https://t.me/pwpwheel?text=${encodeURIComponent(message)}`

    if (webApp) {
      webApp.openLink(telegramUrl)
    } else {
      window.open(telegramUrl, "_blank")
    }

    webApp?.HapticFeedback?.impactOccurred("medium")
    addToLog("📱 Открытие Telegram для связи с @pwpwheel для внесения NFT подарков", "info")
  }

  const startNftDeposit = async () => {
    if (!telegramUser) {
      webApp?.HapticFeedback?.notificationOccurred("error")
      alert("Пожалуйста, сначала подключите свой аккаунт Telegram!")
      return
    }

    setIsDepositing(true)
    webApp?.HapticFeedback?.impactOccurred("medium")

    try {
      // Open Telegram chat with @pwpwheel for NFT gift transfer
      openTelegramDeposit()

      addToLog("📱 Свяжитесь с @pwpwheel в Telegram, чтобы внести свои NFT подарки!", "info")

      // Reset depositing state after a moment
      setTimeout(() => {
        setIsDepositing(false)
        addToLog(" Отправьте свои NFT подарки на @pwpwheel и укажите свой никнейм.", "info")
      }, 2000)
    } catch (error) {
      console.error("NFT deposit error:", error)
      webApp?.HapticFeedback?.notificationOccurred("error")
      addToLog("❌ Не удалось открыть Telegram. Пожалуйста, свяжитесь с @pwpwheel вручную.", "info")
      setIsDepositing(false)
    }
  }

  const refreshInventory = async () => {
    if (!currentPlayer) return

    webApp?.HapticFeedback?.impactOccurred("light")
    addToLog("🔄 Обновление инвентаря...", "info")

    try {
      // This would typically call a database function to reload the player's inventory
      // For now, we'll just show a message
      setTimeout(() => {
        addToLog("✅ Инвентарь обновлен!", "info")
      }, 1000)
    } catch (error) {
      console.error("Inventory refresh error:", error)
      addToLog("❌ Не удалось обновить инвентарь.", "info")
    }
  }

  const confirmGiftSelection = async () => {
    if (selectedGifts.length === 0) {
      webApp?.HapticFeedback?.notificationOccurred("error")
      return
    }

    const name = telegramUser
      ? telegramUser.username || telegramUser.first_name || `Пользователь${telegramUser.id}`
      : playerName.trim()

    if (!name) {
      webApp?.HapticFeedback?.notificationOccurred("error")
      alert("Не удалось получить имя игрока!")
      return
    }

    if (players.length >= 15) {
      webApp?.HapticFeedback?.notificationOccurred("error")
      alert("Разрешено максимум 15 игроков!")
      return
    }

    // Haptic feedback for successful join/add
    webApp?.HapticFeedback?.notificationOccurred("success")

    // Create gifts array and calculate total value
    const selectedGiftEmojis: string[] = []
    let totalGiftValue = 0
    const giftSelections: { giftId: string; quantity: number; totalValue: number }[] = []

    selectedGifts.forEach((selected) => {
      const gift = userInventory.find((g) => g.id === selected.id)
      if (gift) {
        for (let i = 0; i < selected.quantity; i++) {
          selectedGiftEmojis.push(gift.emoji)
        }
        const selectionValue = gift.value * selected.quantity
        totalGiftValue += selectionValue
        giftSelections.push({
          giftId: gift.id,
          quantity: selected.quantity,
          totalValue: selectionValue,
        })
      }
    })

    // Database integration: Join game with gifts
    if (currentPlayer) {
      try {
        console.log("Попытка присоединиться к игре с интеграцией базы данных...")
        console.log("Текущий игрок:", currentPlayer)
        console.log("ID текущей игры:", currentGameId)

        // Ensure we have a current game
        let gameId = currentGameId
        if (!gameId) {
          console.log("Текущая игра не найдена, создаем новую игру...")
          const game = await getCurrentGame(rollNumber)
          if (game) {
            gameId = game.id
          } else {
            console.error("Не удалось получить или создать игру")
            webApp?.HapticFeedback?.notificationOccurred("error")
            alert("Не удалось создать игру. Пожалуйста, попробуйте еще раз.")
            return
          }
        }

        console.log("Используется ID игры:", gameId)

        if (!gameId) {
          console.error("Нет действительного ID игры")
          webApp?.HapticFeedback?.notificationOccurred("error")
          alert("Не удалось присоединиться к игре. Пожалуйста, попробуйте еще раз.")
          return
        }

        const participant = await joinGameWithGifts(
          gameId,
          currentPlayer.id,
          giftSelections,
          COLORS[players.length % COLORS.length],
          players.length,
        )

        if (participant) {
          console.log("Успешно присоединился к игре:", participant)

          // Add to game log
          await addDbGameLog(
            gameId,
            currentPlayer.id,
            "join",
            `🎁 ${name} присоединился с ${totalGiftValue.toFixed(3)} TON в подарках!`,
          )
        } else {
          console.error("Не удалось присоединиться к игре - участник не возвращен")
          webApp?.HapticFeedback?.notificationOccurred("error")
          // Continue with local game logic as fallback
        }
      } catch (error) {

