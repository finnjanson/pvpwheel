# Copilot Instructions

<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Project Overview
This is a Next.js PvP wheel webapp where users can join with their balance and compete in a "winner takes all" wheel game. The project uses TypeScript, Tailwind CSS, and React.

## Key Features
- Users join the game with their name and balance
- Each user gets a colored partition on the wheel proportional to their balance
- The wheel spins automatically every 60 seconds
- Winner takes the entire pot from all players
- Real-time countdown timer and game log
- Responsive design with modern animations

## Technical Stack
- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: React with hooks
- **Canvas**: HTML5 Canvas for wheel rendering
- **Animations**: CSS transitions and keyframes

## Development Guidelines
- Use TypeScript for all components and utilities
- Follow Next.js App Router conventions
- Use Tailwind CSS classes for styling
- Implement responsive design patterns
- Add smooth animations and transitions
- Ensure accessibility standards
- Use React hooks for state management
- Keep components modular and reusable

## Code Style
- Use functional components with hooks
- Implement proper error handling
- Add meaningful comments for complex logic
- Use TypeScript interfaces for type safety
- Follow React best practices for performance
- Use modern ES6+ features
- Implement proper loading states

## Game Logic
- Weighted probability system based on balance
- Automatic countdown and spinning mechanism
- Game state management with React hooks
- Canvas-based wheel rendering with segments
- Winner determination and pot distribution
- Game reset functionality after each round
