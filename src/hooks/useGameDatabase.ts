import { useState, useEffect, useCallback } from 'react'
import { supabase, dbHelpers } from '../lib/supabase'

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  photo_url?: string
}

interface Player {
  id: string
  name: string
  balance: number
  color: string
  gifts: string[]
  giftValue: number
  telegramUser?: TelegramUser
}

interface GameLog {
  id: string
  message: string
  timestamp: Date
  type: 'join' | 'spin' | 'winner' | 'info'
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

export const useGameDatabase = () => {
  const [currentGameId, setCurrentGameId] = useState<string | null>(null)
  const [dbPlayers, setDbPlayers] = useState<any[]>([])
  const [dbGameLogs, setDbGameLogs] = useState<GameLog[]>([])
  const [dbMatchHistory, setDbMatchHistory] = useState<MatchHistoryEntry[]>([])
  const [playerInventory, setPlayerInventory] = useState<any[]>([])
  const [availableGifts, setAvailableGifts] = useState<any[]>([])
  const [currentPlayer, setCurrentPlayer] = useState<any>(null)
  const [gameCountdown, setGameCountdown] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize player from Telegram data
  const initializePlayer = useCallback(async (telegramUser: TelegramUser) => {
    try {
      setLoading(true)
      
      // First check if Supabase is properly configured
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        console.error('Supabase environment variables not configured')
        setError('Database not configured. Please check environment variables.')
        return null
      }
      
      console.log('Attempting to initialize player:', telegramUser.id, telegramUser.username)
      
      const { data: player, error } = await dbHelpers.getOrCreatePlayer(telegramUser)
      
      if (error) {
        console.error('Error creating player:', error)
        console.error('Error details:', {
          message: (error as any).message,
          details: (error as any).details,
          hint: (error as any).hint,
          code: (error as any).code
        })
        setError(`Failed to initialize player: ${(error as any).message}`)
        return null
      }
      
      console.log('Player initialized successfully:', player)
      setCurrentPlayer(player)
      return player
    } catch (err) {
      console.error('Error initializing player:', err)
      setError('Failed to initialize player')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // Load available gifts
  const loadAvailableGifts = useCallback(async () => {
    try {
      const { data: gifts, error } = await dbHelpers.getAllGifts()
      
      if (error) {
        console.error('Error loading gifts:', error)
        return
      }
      
      setAvailableGifts(gifts || [])
    } catch (err) {
      console.error('Error loading gifts:', err)
    }
  }, [])

  // Load player inventory
  const loadPlayerInventory = useCallback(async (playerId: string) => {
    try {
      const { data: inventory, error } = await dbHelpers.getPlayerGifts(playerId)
      
      if (error) {
        console.error('Error loading player inventory:', error)
        return
      }
      
      setPlayerInventory(inventory || [])
    } catch (err) {
      console.error('Error loading player inventory:', err)
    }
  }, [])

  // Get fresh games data
  const getFreshGames = async () => {
    const { data: games, error } = await supabase
      .from('games')
      .select('*')
      .eq('status', 'waiting')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching fresh games:', error)
      return []
    }

    return games
  }

  // Get or create current game
  const getCurrentGame = useCallback(async (rollNumber: number) => {
    try {
      console.log('🎯 Loading current game...', rollNumber > 0 ? `Roll #${rollNumber}` : 'Existing game')
      setLoading(true)
      
      // First, try to get current waiting game
      const { data: currentGame, error: fetchError } = await dbHelpers.getCurrentGame()
      
      if (fetchError) {
        console.error('❌ Error fetching current game:', fetchError)
        setError('Failed to load current game')
        return null
      }
      
      if (currentGame) {
        console.log('✅ Found existing game:', currentGame.roll_number, 'with', currentGame.game_participants?.length || 0, 'players')
        setCurrentGameId(currentGame.id)
        
        // Load participants for this game
        const participants = currentGame.game_participants || []
        
        // Transform participants to match Player interface
        const transformedPlayers = participants.map((participant: any) => {
          // Build gifts array from game_participant_gifts
          const gifts: string[] = []
          if (participant.game_participant_gifts) {
            participant.game_participant_gifts.forEach((giftEntry: any) => {
              const emoji = giftEntry.gifts?.emoji || '🎁'
              for (let i = 0; i < giftEntry.quantity; i++) {
                gifts.push(emoji)
              }
            })
          }
          
          return {
            id: participant.id,
            name: participant.players?.username || participant.players?.first_name || 'Unknown',
            balance: participant.balance || 0,
            color: participant.color,
            gifts: gifts,
            giftValue: participant.gift_value || 0,
            telegramUser: participant.players
          }
        })
        
        setDbPlayers(transformedPlayers)
        return currentGame
      }
      
      // If no current game, create a new one ONLY if we have a valid roll number
      // This prevents creating multiple games unnecessarily
      if (rollNumber && rollNumber > 0) {
        console.log('🆕 Creating new game for Roll #' + rollNumber)
        const { data: newGame, error: createError } = await dbHelpers.createGame(rollNumber)
        
        if (createError) {
          console.error('❌ Error creating new game:', createError)
          setError('Failed to create new game')
          return null
        }
        
        console.log('✅ Created new game:', newGame.id)
        setCurrentGameId(newGame.id)
        setDbPlayers([]) // Empty players for new game
        return newGame
      } else {
        console.log('ℹ️ No current game found')
        return null
      }
    } catch (err) {
      console.error('❌ Error getting current game:', err)
      setError('Failed to get current game')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // Join game with gifts
  const joinGameWithGifts = useCallback(async (
    gameId: string,
    playerId: string,
    giftSelections: { giftId: string; quantity: number; totalValue: number }[],
    color: string,
    positionIndex: number
  ) => {
    try {
      setLoading(true)
      
      console.log('Joining game with gifts:', { gameId, playerId, giftSelections, color, positionIndex })
      
      // Validate inputs
      if (!gameId || !playerId || !giftSelections || giftSelections.length === 0) {
        throw new Error('Invalid parameters for joining game')
      }
      
      // Join the game
      const { data: participant, error: joinError } = await dbHelpers.joinGame(
        gameId,
        playerId,
        giftSelections,
        color,
        positionIndex
      )
      
      if (joinError) {
        console.error('Error joining game:', joinError)
        console.error('Join error details:', {
          message: joinError.message,
          details: joinError.details,
          hint: joinError.hint,
          code: joinError.code
        })
        const errorMessage = joinError.message || 'Unknown database error'
        setError(`Failed to join game: ${errorMessage}`)
        return null
      }
      
      console.log('Successfully joined game:', participant)
      
      // Update player inventory (reduce gift quantities)
      for (const selection of giftSelections) {
        try {
          await dbHelpers.updatePlayerGifts(playerId, selection.giftId, -selection.quantity)
        } catch (inventoryError) {
          console.error('Error updating player gifts:', inventoryError)
          // Continue with other gifts even if one fails
        }
      }
      
      // Reload player inventory
      await loadPlayerInventory(playerId)
      
      return participant
    } catch (err) {
      console.error('Error joining game with gifts:', err)
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(`Failed to join game: ${errorMessage}`)
      return null
    } finally {
      setLoading(false)
    }
  }, [loadPlayerInventory])

  // Load game participants
  const loadGameParticipants = useCallback(async (gameId: string) => {
    try {
      console.log('Loading participants for game:', gameId)
      
      const { data: participants, error } = await supabase
        .from('game_participants')
        .select(`
          *,
          players (
            id,
            username,
            first_name,
            last_name,
            photo_url,
            is_premium
          ),
          game_participant_gifts (
            quantity,
            gifts (
              emoji,
              name,
              base_value
            )
          )
        `)
        .eq('game_id', gameId)
        .order('position_index')
      
      if (error) {
        console.error('Error loading game participants:', error)
        return []
      }
      
      console.log('Loaded participants:', participants)
      
      // Transform to match the Player interface
      const transformedPlayers = (participants || []).map((participant: any) => {
        // Build gifts array from game_participant_gifts
        const gifts: string[] = []
        if (participant.game_participant_gifts) {
          participant.game_participant_gifts.forEach((giftEntry: any) => {
            const emoji = giftEntry.gifts?.emoji || '🎁'
            for (let i = 0; i < giftEntry.quantity; i++) {
              gifts.push(emoji)
            }
          })
        }
        
        return {
          id: participant.id,
          name: participant.players?.username || participant.players?.first_name || 'Unknown',
          balance: participant.balance || 0,
          color: participant.color,
          gifts: gifts,
          giftValue: participant.gift_value || 0,
          telegramUser: participant.players ? {
            id: participant.players.id,
            first_name: participant.players.first_name,
            last_name: participant.players.last_name,
            username: participant.players.username,
            photo_url: participant.players.photo_url,
            is_premium: participant.players.is_premium
          } : undefined
        }
      })
      
      setDbPlayers(transformedPlayers)
      return transformedPlayers
    } catch (err) {
      console.error('Error loading game participants:', err)
      return []
    }
  }, [])
  const completeGame = useCallback(async (
    gameId: string,
    winnerId: string,
    winnerChance: number,
    totalGiftValue: number
  ) => {
    try {
      setLoading(true)
      
      // Update game status to completed
      const { data: completedGame, error } = await dbHelpers.updateGameStatus(
        gameId,
        'completed',
        {
          winner_id: winnerId,
          winner_chance: winnerChance,
          total_gift_value: totalGiftValue,
          completed_at: new Date().toISOString()
        }
      )
      
      if (error) {
        console.error('Error completing game:', error)
        setError('Failed to complete game')
        return null
      }
      
      // Award gifts to winner
      // This would typically involve adding gifts to winner's inventory
      // For now, we'll just log it
      await dbHelpers.addGameLog(
        gameId,
        winnerId,
        'winner',
        `Won ${totalGiftValue.toFixed(3)} TON in gifts!`
      )
      
      return completedGame
    } catch (err) {
      console.error('Error completing game:', err)
      setError('Failed to complete game')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // Add game log
  const addGameLog = useCallback(async (
    gameId: string,
    playerId: string | null,
    logType: 'join' | 'spin' | 'winner' | 'info',
    message: string
  ) => {
    try {
      await dbHelpers.addGameLog(gameId, playerId, logType, message)
    } catch (err) {
      console.error('Error adding game log:', err)
    }
  }, [])

  // Load game logs
  const loadGameLogs = useCallback(async (gameId: string) => {
    try {
      const { data: logs, error } = await dbHelpers.getGameLogs(gameId)
      
      if (error) {
        console.error('Error loading game logs:', error)
        return
      }
      
      const formattedLogs: GameLog[] = (logs || []).map(log => ({
        id: log.id,
        message: log.message,
        timestamp: new Date(log.created_at),
        type: log.log_type as any
      }))
      
      setDbGameLogs(formattedLogs)
    } catch (err) {
      console.error('Error loading game logs:', err)
    }
  }, [])

  // Load match history
  const loadMatchHistory = useCallback(async () => {
    try {
      const { data: history, error } = await dbHelpers.getMatchHistory()
      
      if (error) {
        console.error('Error loading match history:', error)
        return
      }
      
      // Transform database format to component format
      const formattedHistory: MatchHistoryEntry[] = (history || []).map(game => ({
        id: game.id,
        rollNumber: game.roll_number,
        timestamp: new Date(game.completed_at || game.created_at),
        players: game.game_participants?.map((p: any) => ({
          id: p.player_id,
          name: p.players?.username || p.players?.first_name || 'Unknown',
          balance: p.balance,
          color: p.color,
          gifts: [], // Would need to load from game_participant_gifts
          giftValue: p.gift_value,
          telegramUser: undefined
        })) || [],
        winner: {
          id: game.winner_id || '',
          name: game.players?.username || game.players?.first_name || 'Unknown',
          balance: 0,
          color: '#000000',
          gifts: [],
          giftValue: 0,
          telegramUser: undefined
        },
        totalPot: game.total_gift_value || 0,
        winnerChance: game.winner_chance || 0
      }))
      
      setDbMatchHistory(formattedHistory)
    } catch (err) {
      console.error('Error loading match history:', err)
    }
  }, [])

  // Initialize data on mount
  useEffect(() => {
    const initializeData = async () => {
      try {
        console.log('🎮 Initializing PvP Wheel database...')
        
        // Test database connection first
        const connectionTest = await dbHelpers.testConnection()
        if (!connectionTest.success) {
          console.error('❌ Database connection failed:', connectionTest.error)
          const errorMessage = connectionTest.error instanceof Error 
            ? connectionTest.error.message 
            : 'Unknown database connection error'
          setError(`Database connection failed: ${errorMessage}`)
          return
        }
        
        console.log('✅ Database connected, loading game data...')
        
        // Load data in parallel
        await Promise.all([
          loadAvailableGifts(),
          loadMatchHistory()
        ])
        
        console.log('✅ Game data loaded successfully')
      } catch (err) {
        console.error('❌ Error during data initialization:', err)
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        setError(`Failed to initialize application data: ${errorMessage}`)
      }
    }
    
    initializeData()
  }, [loadAvailableGifts, loadMatchHistory])

  // Load player inventory when current player changes
  useEffect(() => {
    if (currentPlayer?.id) {
      loadPlayerInventory(currentPlayer.id)
    }
  }, [currentPlayer, loadPlayerInventory])

  // Load game logs when current game changes
  useEffect(() => {
    if (currentGameId) {
      loadGameLogs(currentGameId)
    }
  }, [currentGameId, loadGameLogs])

  // Real-time subscriptions
  useEffect(() => {
    console.log('Setting up real-time subscriptions...')

    // Global subscription for all waiting games (to detect new games)
    const globalGameSubscription = supabase
      .channel('global_games')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'games'
        },
        async (payload) => {
          console.log('Global game state changed:', payload)
          // Handle different types of game changes
          switch (payload.eventType) {
            case 'INSERT':
              // New game created - immediately get the game if it's in waiting state
              if ((payload.new as any).status === 'waiting') {
                console.log('New waiting game detected, updating state...')
                await getCurrentGame(0)
              }
              break
            case 'UPDATE':
              // Game updated - check if it's relevant to current state
              const newStatus = (payload.new as any).status
              const oldStatus = (payload.old as any).status
              if (newStatus === 'waiting' || oldStatus === 'waiting') {
                console.log('Game status changed, updating state...')
                await getCurrentGame(0)
              }
              break
          }
        }
      )
      .subscribe((status) => {
        console.log('Global game subscription status:', status)
      })

    // Game-specific subscription for current game
    let gameSubscription: any = null
    
    if (currentGameId) {
      console.log('Setting up game-specific subscription for game:', currentGameId)
      
      gameSubscription = supabase
        .channel(`game_${currentGameId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'games',
            filter: `id=eq.${currentGameId}`
          },
          async (payload) => {
            console.log('Game state changed:', payload)
            // Reload game when game state changes (countdown, status, etc.)
            await getCurrentGame(0)
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'game_participants',
            filter: `game_id=eq.${currentGameId}`
          },
          async (payload) => {
            console.log('Game participants changed:', payload)
            // Immediately reload game participants when changes occur
            try {
              const { data: participants, error } = await dbHelpers.getGameParticipants(currentGameId)
              if (!error && participants) {
                // Transform participants to match Player interface
                const transformedPlayers = participants.map((participant: any) => {
                  const gifts: string[] = []
                  if (participant.game_participant_gifts) {
                    participant.game_participant_gifts.forEach((giftEntry: any) => {
                      const emoji = giftEntry.gifts?.emoji || '🎁'
                      for (let i = 0; i < giftEntry.quantity; i++) {
                        gifts.push(emoji)
                      }
                    })
                  }
                  
                  return {
                    id: participant.id,
                    name: participant.players?.username || participant.players?.first_name || 'Unknown',
                    balance: participant.balance || 0,
                    color: participant.color,
                    gifts: gifts,
                    giftValue: participant.gift_value || 0,
                    telegramUser: participant.players
                  }
                })
                
                setDbPlayers(transformedPlayers)
              }
            } catch (err) {
              console.error('Error reloading participants:', err)
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'game_logs',
            filter: `game_id=eq.${currentGameId}`
          },
          async (payload) => {
            console.log('Game logs changed:', payload)
            // Reload logs when new logs are added
            await loadGameLogs(currentGameId)
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'game_participant_gifts',
            filter: `game_participant_id=eq.any(select id from game_participants where game_id=eq.${currentGameId})`
          },
          async () => {
            console.log('Game participant gifts changed')
            // Reload participants when gifts change
            await loadGameParticipants(currentGameId)
          }
        )
        .subscribe((status) => {
          console.log('Game-specific subscription status:', status)
        })
    }

    return () => {
      console.log('Cleaning up real-time subscriptions')
      supabase.removeChannel(globalGameSubscription)
      if (gameSubscription) {
        supabase.removeChannel(gameSubscription)
      }
    }
  }, [currentGameId, loadGameLogs, loadGameParticipants, getCurrentGame])

  // Countdown management
  const startGameCountdown = useCallback(async (gameId: string) => {
    try {
      console.log('Starting countdown for game:', gameId)
      const { data, error } = await dbHelpers.startGameCountdown(gameId, 60)
      
      if (error) {
        console.error('Error starting countdown:', error)
        return false
      }
      
      console.log('Countdown started successfully')
      return true
    } catch (err) {
      console.error('Error starting countdown:', err)
      return false
    }
  }, [])

  const getGameCountdown = useCallback(async (gameId: string) => {
    try {
      const { timeLeft, error } = await dbHelpers.getGameCountdown(gameId)
      
      if (error) {
        console.error('Error getting countdown:', error)
        return null
      }
      
      setGameCountdown(timeLeft)
      return timeLeft
    } catch (err) {
      console.error('Error getting countdown:', err)
      return null
    }
  }, [])

  // Countdown timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    
    if (currentGameId && dbPlayers.length >= 2) {
      // Update countdown every second
      interval = setInterval(async () => {
        const timeLeft = await getGameCountdown(currentGameId)
        if (timeLeft !== null && timeLeft <= 0) {
          // Time's up, trigger spin
          console.log('Countdown reached zero, should trigger spin')
          setGameCountdown(0)
        }
      }, 1000)
    }
    
    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [currentGameId, dbPlayers.length, getGameCountdown])

  return {
    // State
    currentGameId,
    currentPlayer,
    dbPlayers,
    dbGameLogs,
    dbMatchHistory,
    playerInventory,
    availableGifts,
    gameCountdown,
    loading,
    error,

    // Actions
    initializePlayer,
    getCurrentGame,
    joinGameWithGifts,
    completeGame,
    addGameLog,
    loadGameLogs,
    loadMatchHistory,
    loadPlayerInventory,
    loadAvailableGifts,
    loadGameParticipants,
    startGameCountdown,
    getGameCountdown,

    // Utilities
    clearError: () => setError(null)
  }
}

export default useGameDatabase
