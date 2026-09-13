import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Player,
  FormationType,
  Language,
  FORMATIONS,
  CustomPlayerPosition,
  MainPosition,
  UserTeam,
} from '../types';
import { TRANSLATIONS, getLocalizedPlayerName, getLocalizedPosition } from '../utils/translations';
import { soundManager } from '../utils/audio';
import {
  remapPlayerSlots,
  detectBasePresetFromSlots,
  PRESET_FORMATIONS,
  getDisplayFormationName,
  getPositionCategory,
} from '../utils/formationUtils';
import {
  getEFootballPositionFromCoords,
  normalizeRoleToEFootball,
  evaluatePlayerAtPosition,
  getTeamEffectiveOvr,
  canPlayerPlayAtPosition,
} from '../utils/positionEngine';
import { PlayerDetailModal } from './PlayerDetailModal';
import { DefenseSquadModal } from './DefenseSquadModal';
import {
  Share2,
  RotateCcw,
  Check,
  Award,
  Shield,
  Zap,
  Sparkles,
  Move,
  AlertTriangle,
  X,
  Plus,
  Play,
  Trash2,
  Users,
  MapPin,
  Lock,
  Unlock,
  CheckCircle,
  HelpCircle,
  ArrowLeftRight,
  Trophy,
} from 'lucide-react';

interface PitchSlot {
  id: string;
  role: string;
  pos: MainPosition;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
}

interface PitchViewProps {
  teams?: UserTeam[];
  activeTeamId?: string;
  defenseSquadId?: string;
  onSetDefenseSquad?: (teamId: string) => void;
  onSelectTeam?: (teamId: string) => void;
  onCreateNewTeam?: () => void;
  onDeleteTeam?: (teamId: string) => void;
  onContinueDraft?: (teamId: string) => void;
  onOpenShare?: (team: UserTeam) => void;
  myTeam: Player[];
  playerSlots: Record<string, string>; // slotId -> playerId
  onUpdateSlotAssignment: (newSlots: Record<string, string>) => void;
  formation: FormationType;
  onChangeFormation: (formation: FormationType) => void;
  customPositions: Record<string, CustomPlayerPosition>;
  onUpdateCustomPositions: (positions: Record<string, CustomPlayerPosition>) => void;
  language: Language;
  isLocked?: boolean;
  onToggleLock?: (teamId: string, willLock: boolean) => void;
}

export const PitchView: React.FC<PitchViewProps> = ({
  teams,
  activeTeamId,
  defenseSquadId,
  onSetDefenseSquad,
  onSelectTeam,
  onCreateNewTeam,
  onDeleteTeam,
  onContinueDraft,
  onOpenShare,
  myTeam,
  playerSlots,
  onUpdateSlotAssignment,
  formation,
  onChangeFormation,
  customPositions,
  onUpdateCustomPositions,
  language,
  isLocked: propIsLocked,
  onToggleLock,
}) => {
  const t = TRANSLATIONS[language];
  const pitchRef = useRef<HTMLDivElement>(null);

  // Current active team record
  const currentTeam = teams?.find((t) => t.teamId === activeTeamId);
  const currentTeamNumber = currentTeam?.teamNumber || 1;
  const isTeamLocked = propIsLocked ?? currentTeam?.isLocked ?? false;

  // UI Modals & Notifications
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [teamToDelete, setTeamToDelete] = useState<string | null>(null);
  const [lockNoticeToast, setLockNoticeToast] = useState<string | null>(null);
  const [moveErrorNotice, setMoveErrorNotice] = useState<string | null>(null);

  // Player Detail Modal state (opened via ONE-TAP)
  const [selectedPlayerForDetail, setSelectedPlayerForDetail] = useState<{
    player: Player;
    role: string;
    slotId: string;
  } | null>(null);

  // Drag-and-drop state (triggered strictly via hold 280ms + drag)
  const [draggingSlotId, setDraggingSlotId] = useState<string | null>(null);
  const [dragCoord, setDragCoord] = useState<{ x: number; y: number } | null>(null);
  const [hoveredSwapSlotId, setHoveredSwapSlotId] = useState<string | null>(null);
  const [longPressingSlotId, setLongPressingSlotId] = useState<string | null>(null);

  // Tap-to-Swap Mode state (explicit toggle button in toolbar)
  const [isSwapMode, setIsSwapMode] = useState<boolean>(false);
  const [selectedSwapSourceSlotId, setSelectedSwapSourceSlotId] = useState<string | null>(null);

  // Defense Squad Modal state (v1.2.5 independent defense squads)
  const [isDefenseSquadModalOpen, setIsDefenseSquadModalOpen] = useState<boolean>(false);

  // Pointer event references for strictly separating Tap (<280ms) vs Drag
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pointerStateRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    slotId: string;
    hasMoved: boolean;
    isLongPressTriggered: boolean;
  } | null>(null);
  const isCommittingRef = useRef<boolean>(false);

  // Determine base preset
  const currentPresetBase: Exclude<FormationType, 'CUSTOM'> =
    formation === 'CUSTOM'
      ? detectBasePresetFromSlots(Object.keys(playerSlots))
      : formation;
  const baseSlots = FORMATIONS[currentPresetBase]?.slots || FORMATIONS['4-3-3'].slots;

  // Resolve player slots: if playerSlots is empty (first load of new team), map players into slots.
  // Once slots are established, respect empty slots, BUT strictly ensure that EVERY player in myTeam is assigned!
  // Owned players must NEVER be dropped or omitted from the pitch.
  const resolvedPlayerSlots = useMemo(() => {
    if (!playerSlots || Object.keys(playerSlots).length === 0) {
      return remapPlayerSlots(myTeam, {}, formation);
    }
    // Retain user's actual slot placements, verifying players still belong to this squad
    const valid: Record<string, string> = {};
    const teamPlayerIds = new Set(myTeam.map((p) => p.playerId));
    for (const [slotId, pId] of Object.entries(playerSlots)) {
      if (pId && typeof pId === 'string' && teamPlayerIds.has(pId)) {
        valid[slotId] = pId;
      }
    }

    // CRITICAL RESCUE: Ensure 100% of players in myTeam have a slot on the pitch!
    const assignedIds = new Set(Object.values(valid));
    const unassignedPlayers = myTeam.filter((p) => !assignedIds.has(p.playerId));
    if (unassignedPlayers.length > 0) {
      const occupiedSlotIds = new Set(Object.keys(valid));
      const openSlots = baseSlots.filter((s) => !occupiedSlotIds.has(s.id));
      for (const p of unassignedPlayers) {
        if (openSlots.length > 0) {
          // Find best fitting open slot, or non-GK slot, or any open slot
          let bestIdx = openSlots.findIndex((s) => {
            const ePos = normalizeRoleToEFootball(s.role);
            return canPlayerPlayAtPosition(p, ePos).allowed;
          });
          if (bestIdx === -1 && p.position !== 'GK') {
            bestIdx = openSlots.findIndex((s) => s.pos !== 'GK' && s.role !== 'GK');
          }
          if (bestIdx === -1) bestIdx = 0;
          const targetSlot = openSlots.splice(bestIdx, 1)[0];
          valid[targetSlot.id] = p.playerId;
          assignedIds.add(p.playerId);
        } else {
          // Dynamic slot ID fallback so the player is never lost
          const dynId = `slot_auto_${p.playerId}`;
          valid[dynId] = p.playerId;
          assignedIds.add(p.playerId);
        }
      }
    }

    return valid;
  }, [myTeam, playerSlots, formation, baseSlots]);

  // Sync back to state if resolvedPlayerSlots added missing players or initialized from empty
  useEffect(() => {
    if (myTeam.length > 0) {
      const currentAssignedCount = Object.values(playerSlots || {}).filter(Boolean).length;
      const resolvedAssignedCount = Object.values(resolvedPlayerSlots).filter(Boolean).length;
      const hasUnassignedPlayer = myTeam.some((p) => !Object.values(playerSlots || {}).includes(p.playerId));
      if (currentAssignedCount === 0 || resolvedAssignedCount > currentAssignedCount || hasUnassignedPlayer) {
        onUpdateSlotAssignment(resolvedPlayerSlots);
      }
    }
  }, [resolvedPlayerSlots, playerSlots, onUpdateSlotAssignment, myTeam]);

  // Active slots: strictly includes all 11 base slots of the formation (occupied or empty).
  // Custom positions override slot coordinates, ensuring exactly 11 slots are ever rendered.
  const activeSlots: PitchSlot[] = useMemo(() => {
    const slotsMap = new Map<string, PitchSlot>();

    baseSlots.forEach((baseSlot) => {
      const pId = resolvedPlayerSlots[baseSlot.id];
      const custom = (customPositions[baseSlot.id] || (pId ? customPositions[pId] : undefined)) as
        | { x: number; y: number; role?: string }
        | undefined;
      if (custom) {
        const x = custom.x;
        const y = custom.y;
        const dynamicRole = custom.role || getEFootballPositionFromCoords(x, y);
        slotsMap.set(baseSlot.id, {
          ...baseSlot,
          x,
          y,
          role: dynamicRole,
          pos: getPositionCategory(dynamicRole),
        });
      } else {
        slotsMap.set(baseSlot.id, { ...baseSlot });
      }
    });

    // Ensure any extra assigned slot is also rendered
    Object.entries(resolvedPlayerSlots).forEach(([slotId, pId]) => {
      if (pId && !slotsMap.has(slotId)) {
        const custom = customPositions[slotId] as { x: number; y: number; role?: string } | undefined;
        const x = custom?.x ?? 50;
        const y = custom?.y ?? 50;
        const dynamicRole = custom?.role || getEFootballPositionFromCoords(x, y);
        slotsMap.set(slotId, {
          id: slotId,
          role: dynamicRole,
          pos: getPositionCategory(dynamicRole),
          x,
          y,
        });
      }
    });

    return Array.from(slotsMap.values());
  }, [baseSlots, customPositions, resolvedPlayerSlots]);

  // Calculate team effective OVR in real-time
  const averageRating = useMemo(() => {
    return getTeamEffectiveOvr({
      teamId: activeTeamId || 'active',
      teamNumber: currentTeamNumber,
      name: currentTeam?.name || `TEAM ${currentTeamNumber}`,
      formation,
      players: myTeam,
      playerSlots: resolvedPlayerSlots,
      customPositions,
      isLocked: isTeamLocked,
    });
  }, [
    activeTeamId,
    currentTeamNumber,
    currentTeam?.name,
    formation,
    myTeam,
    resolvedPlayerSlots,
    customPositions,
    isTeamLocked,
  ]);

  // 自由配置判定: 選手を1人でも元の配置から自由に移動している場合
  const hasCustomPositions = useMemo(() => {
    return Boolean(customPositions && Object.keys(customPositions).length > 0);
  }, [customPositions]);

  // フォーメーション名表示: 自由配置時は「カスタムフォーメーション」、通常配置時は正式名称
  const displayFormationName = useMemo(() => {
    return getDisplayFormationName(formation, customPositions);
  }, [formation, customPositions]);

  // Chemistry calculation
  let chemistryPoints = 0;
  for (let i = 0; i < myTeam.length; i++) {
    for (let j = i + 1; j < myTeam.length; j++) {
      if (myTeam[i].clubId === myTeam[j].clubId) chemistryPoints += 8;
      if (myTeam[i].nationality === myTeam[j].nationality) chemistryPoints += 4;
    }
  }
  const maxChem = 100;
  const chemistry = Math.min(
    maxChem,
    Math.round(chemistryPoints * 1.5) + (myTeam.length === 11 ? 25 : 0)
  );

  // ---------------------------------------------------------------------------
  // SWAP EXECUTION LOGIC (Always available via drag-to-swap or tap-to-swap)
  // ---------------------------------------------------------------------------
  const executeSwap = (slotAId: string, slotBId: string) => {
    const playerAId = resolvedPlayerSlots[slotAId];
    const playerBId = resolvedPlayerSlots[slotBId];
    const playerA = myTeam.find((p) => p.playerId === playerAId);
    const playerB = myTeam.find((p) => p.playerId === playerBId);

    if (!playerA || !playerB) return;

    soundManager.playSlotStop();

    // Swap the slot assignments
    const updated = {
      ...resolvedPlayerSlots,
      [slotAId]: playerBId,
      [slotBId]: playerAId,
    };
    onUpdateSlotAssignment(updated);

    // Clean up any legacy playerId keys from customPositions (only slotIds should be stored)
    if (customPositionsRef.current) {
      const nextCustom = { ...customPositionsRef.current };
      delete nextCustom[playerA.playerId];
      delete nextCustom[playerB.playerId];
      customPositionsRef.current = nextCustom;
      onUpdateCustomPositions(nextCustom);
    }
  };

  // ---------------------------------------------------------------------------
  // MOVE TO EMPTY SLOT LOGIC (Pattern A: Player ↔ Empty Position Slot)
  // ---------------------------------------------------------------------------
  const executeMoveToEmptySlot = (sourceSlotId: string, emptySlotId: string) => {
    const movingPlayerId = resolvedPlayerSlots[sourceSlotId];
    const movingPlayer = myTeam.find((p) => p.playerId === movingPlayerId);
    if (!movingPlayer) return;

    soundManager.playSlotStop();

    // Source slot becomes empty (playerId deleted), target slot gets moving player
    const updated = { ...resolvedPlayerSlots };
    delete updated[sourceSlotId];
    updated[emptySlotId] = movingPlayerId;
    onUpdateSlotAssignment(updated);

    // Keep custom positions in sync - ensure NO playerId keys are stored
    const nextCustom = { ...customPositionsRef.current };
    delete nextCustom[movingPlayer.playerId];
    customPositionsRef.current = nextCustom;
    onUpdateCustomPositions(nextCustom);

    const targetSlotObj = activeSlotsRef.current.find((s) => s.id === emptySlotId);
  };

  // Dynamic synchronization refs for event listeners
  const draggingSlotIdRef = useRef<string | null>(null);
  draggingSlotIdRef.current = draggingSlotId;

  const dragCoordRef = useRef<{ x: number; y: number } | null>(null);
  dragCoordRef.current = dragCoord;

  const hoveredSwapSlotIdRef = useRef<string | null>(null);
  hoveredSwapSlotIdRef.current = hoveredSwapSlotId;

  const activeSlotsRef = useRef<PitchSlot[]>(activeSlots);
  activeSlotsRef.current = activeSlots;

  const resolvedPlayerSlotsRef = useRef<Record<string, string>>(resolvedPlayerSlots);
  resolvedPlayerSlotsRef.current = resolvedPlayerSlots;

  const customPositionsRef = useRef<Record<string, { x: number; y: number; role?: string }>>(customPositions);
  customPositionsRef.current = customPositions;

  const myTeamRef = useRef<Player[]>(myTeam);
  myTeamRef.current = myTeam;

  // ---------------------------------------------------------------------------
  // INTERACTION HANDLING: ONE-TAP (<260ms, dist < 20px) vs HOLD+DRAG (>=260ms)
  // ---------------------------------------------------------------------------
  const commitDropOrSwap = () => {
    if (isCommittingRef.current) return;
    const slotIdToCommit = draggingSlotIdRef.current || draggingSlotId;
    if (!slotIdToCommit) return;

    isCommittingRef.current = true;
    const targetSwapId = hoveredSwapSlotIdRef.current || hoveredSwapSlotId;
    const targetCoord = dragCoordRef.current || dragCoord;

    // Reset drag indicators immediately
    setDraggingSlotId(null);
    setDragCoord(null);
    setHoveredSwapSlotId(null);
    setLongPressingSlotId(null);

    try {
      const movingPlayer = myTeamRef.current.find(
        (p) => p.playerId === resolvedPlayerSlotsRef.current[slotIdToCommit]
      );
      if (!movingPlayer) return;

      // Check if dropped directly onto another slot (occupied or empty)
      let finalTargetSwapId = targetSwapId;
      if (!finalTargetSwapId && targetCoord) {
        let closestDist = Infinity;
        activeSlotsRef.current.forEach((s) => {
          if (s.id === slotIdToCommit) return;
          const dist = Math.hypot(targetCoord.x - s.x, targetCoord.y - s.y);
          if (dist < 8.0 && dist < closestDist) {
            closestDist = dist;
            finalTargetSwapId = s.id;
          }
        });
      }

      if (finalTargetSwapId && finalTargetSwapId !== slotIdToCommit) {
        const otherPlayerId = resolvedPlayerSlotsRef.current[finalTargetSwapId];
        const otherPlayer = otherPlayerId
          ? myTeamRef.current.find((p) => p.playerId === otherPlayerId)
          : null;

        if (otherPlayer) {
          // === PATTERN B: 別の選手がいる場所 ===
          // A選手をB選手の位置へドラッグ -> AとBの位置を交換 (A ↔ B)
          executeSwap(slotIdToCommit, finalTargetSwapId);
        } else {
          // === PATTERN A: 空いているポジション枠 ===
          // A選手を空いている枠へドラッグ -> A選手を空き位置へ移動、元の位置は空き枠になる！
          executeMoveToEmptySlot(slotIdToCommit, finalTargetSwapId);
        }
      } else if (targetCoord) {
        // === PATTERN C: ピッチ上の自由なX/Y相対座標へ配置 ===
        const dynamicRole = getEFootballPositionFromCoords(targetCoord.x, targetCoord.y);

        const nextCustom = {
          ...customPositionsRef.current,
          [slotIdToCommit]: {
            x: targetCoord.x,
            y: targetCoord.y,
            role: dynamicRole,
          },
        };
        // Clean up any legacy playerId keys
        delete nextCustom[movingPlayer.playerId];

        customPositionsRef.current = nextCustom;
        onUpdateCustomPositions(nextCustom);

        soundManager.playButtonClick();
      }
    } finally {
      document.body.style.overflow = '';
      setTimeout(() => {
        isCommittingRef.current = false;
      }, 80);
    }
  };

  // Window-level tracking during drag for ultra-smooth tracking across entire screen & touch devices
  useEffect(() => {
    if (!draggingSlotId) return;

    const handleWindowMove = (e: MouseEvent | TouchEvent | PointerEvent) => {
      if (!pitchRef.current) return;
      if (e.cancelable && 'touches' in e) {
        e.preventDefault();
      }

      const clientX =
        'touches' in e && e.touches.length > 0
          ? e.touches[0].clientX
          : (e as MouseEvent).clientX;
      const clientY =
        'touches' in e && e.touches.length > 0
          ? e.touches[0].clientY
          : (e as MouseEvent).clientY;

      if (clientX === undefined || clientY === undefined) return;

      const rect = pitchRef.current.getBoundingClientRect();
      const rawX = ((clientX - rect.left) / rect.width) * 100;
      const rawY = ((clientY - rect.top) / rect.height) * 100;
      const clampedX = Math.round(Math.max(5, Math.min(95, rawX)));
      const clampedY = Math.round(Math.max(5, Math.min(95, rawY)));

      setDragCoord({ x: clampedX, y: clampedY });

      // Overlapping check for SWAP or MOVE TO EMPTY SLOT
      let overlappingOtherSlotId: string | null = null;
      let minOverlapDist = Infinity;

      activeSlotsRef.current.forEach((otherSlot) => {
        if (otherSlot.id === draggingSlotIdRef.current) return;

        const dx = Math.abs(clampedX - otherSlot.x);
        const dy = Math.abs(clampedY - otherSlot.y);
        const dist = Math.hypot(dx, dy);

        if (dx < 8.0 && dy < 9.0 && dist < 8.5) {
          if (dist < minOverlapDist) {
            minOverlapDist = dist;
            overlappingOtherSlotId = otherSlot.id;
          }
        }
      });

      setHoveredSwapSlotId(overlappingOtherSlotId);
    };

    const handleWindowEnd = () => {
      commitDropOrSwap();
    };

    window.addEventListener('pointermove', handleWindowMove);
    window.addEventListener('pointerup', handleWindowEnd);
    window.addEventListener('pointercancel', handleWindowEnd);
    window.addEventListener('touchmove', handleWindowMove, { passive: false });
    window.addEventListener('touchend', handleWindowEnd, { passive: false });
    window.addEventListener('touchcancel', handleWindowEnd, { passive: false });

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('pointermove', handleWindowMove);
      window.removeEventListener('pointerup', handleWindowEnd);
      window.removeEventListener('pointercancel', handleWindowEnd);
      window.removeEventListener('touchmove', handleWindowMove);
      window.removeEventListener('touchend', handleWindowEnd);
      window.removeEventListener('touchcancel', handleWindowEnd);
    };
  }, [draggingSlotId]);

  const startDragOrTapTimer = (slotId: string, clientX: number, clientY: number) => {
    if (isTeamLocked) {
      soundManager.playError();
      setLockNoticeToast('🔒 チームがロックされています。解除してから配置変更を行ってください。');
      setTimeout(() => setLockNoticeToast(null), 3000);
      return;
    }

    const pId = resolvedPlayerSlots[slotId];
    const player = myTeam.find((p) => p.playerId === pId);
    if (!player) return;

    // Handle Tap-to-Swap Mode
    if (isSwapMode) {
      if (!selectedSwapSourceSlotId) {
        soundManager.playButtonClick();
        setSelectedSwapSourceSlotId(slotId);
        return;
      } else if (selectedSwapSourceSlotId === slotId) {
        soundManager.playButtonClick();
        setSelectedSwapSourceSlotId(null);
        return;
      } else {
        executeSwap(selectedSwapSourceSlotId, slotId);
        setSelectedSwapSourceSlotId(null);
        return;
      }
    }

    pointerStateRef.current = {
      startX: clientX,
      startY: clientY,
      startTime: Date.now(),
      slotId,
      hasMoved: false,
      isLongPressTriggered: false,
    };

    setLongPressingSlotId(slotId);

    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
    }

    // 260ms threshold: Quick tap opens details modal; Hold enters drag mode
    pressTimerRef.current = setTimeout(() => {
      if (!pointerStateRef.current) return;

      pointerStateRef.current.isLongPressTriggered = true;
      setLongPressingSlotId(null);
      setDraggingSlotId(slotId);
      document.body.style.overflow = 'hidden';

      const slotObj = activeSlotsRef.current.find((s) => s.id === slotId);
      if (slotObj) {
        setDragCoord({ x: slotObj.x, y: slotObj.y });
      }

      try {
        if ('vibrate' in navigator) navigator.vibrate([40]);
      } catch (err) {}

      soundManager.playButtonClick();
    }, 260);
  };

  const handlePointerOrTouchMove = (clientX: number, clientY: number) => {
    if (!pointerStateRef.current) return;

    const dist = Math.hypot(
      clientX - pointerStateRef.current.startX,
      clientY - pointerStateRef.current.startY
    );

    // If moved before 260ms, only cancel long-press if finger moved beyond micro-tremor threshold (20px)
    if (!pointerStateRef.current.isLongPressTriggered) {
      if (dist > 20) {
        pointerStateRef.current.hasMoved = true;
        setLongPressingSlotId(null);
        if (pressTimerRef.current) {
          clearTimeout(pressTimerRef.current);
          pressTimerRef.current = null;
        }
      }
      return;
    }

    // Drag mode active: update coordinate smoothly
    if (pitchRef.current && (draggingSlotId || draggingSlotIdRef.current)) {
      const rect = pitchRef.current.getBoundingClientRect();
      const rawX = ((clientX - rect.left) / rect.width) * 100;
      const rawY = ((clientY - rect.top) / rect.height) * 100;
      const clampedX = Math.round(Math.max(5, Math.min(95, rawX)));
      const clampedY = Math.round(Math.max(5, Math.min(95, rawY)));

      setDragCoord({ x: clampedX, y: clampedY });

      // Overlapping check for SWAP or MOVE TO EMPTY SLOT
      let overlappingOtherSlotId: string | null = null;
      let minOverlapDist = Infinity;

      activeSlotsRef.current.forEach((otherSlot) => {
        if (otherSlot.id === draggingSlotIdRef.current) return;

        const dx = Math.abs(clampedX - otherSlot.x);
        const dy = Math.abs(clampedY - otherSlot.y);
        const dist = Math.hypot(dx, dy);

        if (dx < 8.0 && dy < 9.0 && dist < 8.5) {
          if (dist < minOverlapDist) {
            minOverlapDist = dist;
            overlappingOtherSlotId = otherSlot.id;
          }
        }
      });

      setHoveredSwapSlotId(overlappingOtherSlotId);
    }
  };

  const handlePointerOrTouchEnd = (slotId: string, clientX: number, clientY: number) => {
    document.body.style.overflow = '';
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    setLongPressingSlotId(null);

    const pState = pointerStateRef.current;
    pointerStateRef.current = null;

    if (!pState) {
      if (draggingSlotIdRef.current || draggingSlotId) {
        commitDropOrSwap();
      }
      return;
    }

    const dist = Math.hypot(clientX - pState.startX, clientY - pState.startY);

    // 1. ONE-TAP DETECTED: Tap duration < 260ms AND movement < 20px
    if (!pState.isLongPressTriggered && dist < 20) {
      if (isSwapMode) {
        if (selectedSwapSourceSlotId) {
          if (selectedSwapSourceSlotId === slotId) {
            setSelectedSwapSourceSlotId(null);
          } else {
            const pAId = resolvedPlayerSlots[selectedSwapSourceSlotId];
            const pBId = resolvedPlayerSlots[slotId];
            if (pAId && pBId) {
              executeSwap(selectedSwapSourceSlotId, slotId);
            } else if (pAId && !pBId) {
              executeMoveToEmptySlot(selectedSwapSourceSlotId, slotId);
            } else if (!pAId && pBId) {
              executeMoveToEmptySlot(slotId, selectedSwapSourceSlotId);
            }
            setSelectedSwapSourceSlotId(null);
          }
        } else {
          setSelectedSwapSourceSlotId(slotId);
        }
        return;
      }

      const pId = resolvedPlayerSlots[slotId];
      const player = myTeam.find((p) => p.playerId === pId);
      if (player) {
        const slot = activeSlots.find((s) => s.id === slotId);
        soundManager.playCardFlip();
        setSelectedPlayerForDetail({
          player,
          role: slot?.role || player.position,
          slotId,
        });
      }
      return;
    }

    // 2. DRAG DROP EXECUTION
    if (pState.isLongPressTriggered || draggingSlotIdRef.current || draggingSlotId) {
      commitDropOrSwap();
    }
  };

  const handleSlotPointerDown = (slotId: string, e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {}
    startDragOrTapTimer(slotId, e.clientX, e.clientY);
  };

  const handleSlotPointerMove = (e: React.PointerEvent) => {
    handlePointerOrTouchMove(e.clientX, e.clientY);
  };

  const handleSlotPointerUp = (slotId: string, e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {}
    handlePointerOrTouchEnd(slotId, e.clientX, e.clientY);
  };

  const handleSlotPointerCancel = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (draggingSlotIdRef.current || draggingSlotId) {
      commitDropOrSwap();
    } else {
      setLongPressingSlotId(null);
      setDraggingSlotId(null);
      setDragCoord(null);
      setHoveredSwapSlotId(null);
      pointerStateRef.current = null;
    }
  };

  // Touch event handlers for seamless native smartphone support
  const handleSlotTouchStart = (slotId: string, e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      startDragOrTapTimer(slotId, e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleSlotTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      if (pointerStateRef.current?.isLongPressTriggered && e.cancelable) {
        e.preventDefault();
      }
      handlePointerOrTouchMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleSlotTouchEnd = (slotId: string, e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    const clientX = touch ? touch.clientX : (pointerStateRef.current?.startX ?? 0);
    const clientY = touch ? touch.clientY : (pointerStateRef.current?.startY ?? 0);
    handlePointerOrTouchEnd(slotId, clientX, clientY);
  };

  // ---------------------------------------------------------------------------
  // TEAM LOCK / UNLOCK TOGGLE HANDLERS (Requirement #31)
  // ---------------------------------------------------------------------------
  const handleLockClick = () => {
    soundManager.playButtonClick();
    if (!activeTeamId) return;

    if (isTeamLocked) {
      // Prompt confirmation before unlocking
      setShowUnlockConfirm(true);
    } else {
      // Lock the team immediately
      if (onToggleLock) {
        onToggleLock(activeTeamId, true);
      }
      setLockNoticeToast('🔒 チームをロックしました。PvP防衛チームとして保護されています。');
      setTimeout(() => setLockNoticeToast(null), 3000);
    }
  };

  const handleConfirmUnlock = () => {
    soundManager.playButtonClick();
    setShowUnlockConfirm(false);
    if (activeTeamId && onToggleLock) {
      onToggleLock(activeTeamId, false);
    }
    setLockNoticeToast('🔓 チームロックを解除しました。配置変更が可能です。');
    setTimeout(() => setLockNoticeToast(null), 3000);
  };

  // ---------------------------------------------------------------------------
  // FORMATION SWITCH & RESET
  // ---------------------------------------------------------------------------
  const handleFormationChange = (newFormation: FormationType) => {
    if (isTeamLocked) return;
    soundManager.playButtonClick();
    onChangeFormation(newFormation);
    onUpdateCustomPositions({});
    const basePreset = newFormation === 'CUSTOM' ? '4-3-3' : newFormation;
    const newSlots = remapPlayerSlots(myTeam, playerSlots, basePreset);
    onUpdateSlotAssignment(newSlots);
  };

  const handleConfirmReset = () => {
    soundManager.playButtonClick();
    if (isTeamLocked) {
      setLockNoticeToast('🔒 ロック中は初期配置に戻せません。ロックを解除してください。');
      setTimeout(() => setLockNoticeToast(null), 3000);
      setShowResetConfirm(false);
      return;
    }

    const basePreset = formation === 'CUSTOM' ? '4-3-3' : formation;
    if (formation === 'CUSTOM') {
      onChangeFormation('4-3-3');
    }
    onUpdateCustomPositions({});
    const defaultSlots = remapPlayerSlots(myTeam, {}, basePreset);
    onUpdateSlotAssignment(defaultSlots);
    setShowResetConfirm(false);
    setLockNoticeToast('初期配置に戻しました');
    setTimeout(() => setLockNoticeToast(null), 2500);
  };

  // ---------------------------------------------------------------------------
  // SHARE TEAM
  // ---------------------------------------------------------------------------
  const handleShareTeam = () => {
    soundManager.playButtonClick();
    if (onOpenShare && currentTeam) {
      onOpenShare(currentTeam);
      return;
    }
    const lineupText = [
      `⚽ MY FOOTBALL DRAFT BEST XI (${currentTeam?.name || `TEAM ${currentTeamNumber}`})`,
      `Formation: ${displayFormationName}`,
      `Squad OVR: ${averageRating} | Chemistry: ${chemistry}%`,
      '--------------------------------',
      ...activeSlots.map((s, idx) => {
        const pId = resolvedPlayerSlots[s.id];
        const player = myTeam.find((p) => p.playerId === pId);
        return `${idx + 1}. [${s.role}] ${
          player
            ? `${player.playerName} (${player.clubName}, ${player.joiningYear}) OVR:${player.rating}`
            : 'EMPTY'
        }`;
      }),
      '--------------------------------',
      'Play Football Draft now!',
    ].join('\n');

    navigator.clipboard.writeText(lineupText).then(() => {
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 3000);
    });
  };

  return (
    <div id="pitch-view-container" className="space-y-4 sm:space-y-6 animate-fadeIn select-none">
      {/* 1. Multi-Team Selector Tabs */}
      {teams && teams.length > 0 && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2.5 sm:p-3 shadow-xl flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full">
            {teams.map((tItem) => {
              const isSelected = tItem.teamId === activeTeamId;
              const isFull = tItem.players.length === 11;
              const isItemLocked = tItem.isLocked;
              return (
                <button
                  key={tItem.teamId}
                  onClick={() => {
                    soundManager.playButtonClick();
                    if (onSelectTeam) onSelectTeam(tItem.teamId);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 border cursor-pointer ${
                    isSelected
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-400 shadow-lg shadow-emerald-950/60'
                      : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>{tItem.name}</span>
                  {isItemLocked && <Lock className="w-3 h-3 text-amber-400" />}
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-black ${
                      isFull
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-slate-800 text-emerald-300 border border-emerald-500/30'
                    }`}
                  >
                    {tItem.players.length}/11
                  </span>
                  {isFull && <span className="text-[10px]">👑</span>}
                </button>
              );
            })}

            {/* Create New Team button */}
            {onCreateNewTeam && (
              <button
                id="btn-create-new-team-tab"
                onClick={() => {
                  soundManager.playButtonClick();
                  onCreateNewTeam();
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:border-emerald-400 transition-all shrink-0 shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{t.createNewTeam}</span>
              </button>
            )}
          </div>

          {/* Delete Team Button */}
          {onDeleteTeam && teams.length > 1 && activeTeamId && (
            <button
              onClick={() => {
                const target = teams.find((tItem) => tItem.teamId === activeTeamId);
                if (target?.isLocked) {
                  soundManager.playError();
                  setLockNoticeToast('🔒 このチームはロックされています。削除するには先にロックを解除してください。');
                  setTimeout(() => setLockNoticeToast(null), 3500);
                  return;
                }
                setTeamToDelete(activeTeamId);
              }}
              title={t.deleteTeam}
              className="p-2 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* 2. Top Header & Formation Controls Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-4">
        {/* Row A: Team Stats & Share Button */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-heading font-black text-lg sm:text-xl text-white tracking-wide">
                {currentTeam?.name || `TEAM ${currentTeamNumber}`}
              </h3>
              <span
                id="pitch-formation-badge"
                className={`px-2.5 py-0.5 rounded-full text-xs font-heading font-black border transition-all ${
                  hasCustomPositions
                    ? 'bg-amber-500/20 text-amber-300 border-amber-400/50 shadow-sm'
                    : 'bg-slate-800 text-teal-300 border-teal-500/30'
                }`}
              >
                {displayFormationName}
              </span>
              {isTeamLocked ? (
                <span className="text-[10px] font-mono font-black px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  <span>LOCKED (防衛チーム)</span>
                </span>
              ) : (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
                  <Unlock className="w-3 h-3" />
                  <span>EDITABLE</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              ワンタップで選手詳細を表示 • 長押し＋ドラッグで自由移動＆選手に重ねて入替
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Squad OVR Badge */}
            <div className="px-3 py-1.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-center">
              <div className="text-[9px] font-mono text-slate-400 uppercase">SQUAD OVR</div>
              <div className="text-xl font-heading font-black text-amber-400 leading-tight">
                {averageRating}
              </div>
            </div>

            {/* Chemistry Badge */}
            <div className="px-3 py-1.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-center">
              <div className="text-[9px] font-mono text-slate-400 uppercase">CHEMISTRY</div>
              <div className="text-xl font-heading font-black text-emerald-400 leading-tight">
                {chemistry}%
              </div>
            </div>

            {/* Defense Squad Settings Button (v1.2.5) */}
            <button
              id="btn-open-defense-squad-modal"
              onClick={() => {
                soundManager.playButtonClick();
                setIsDefenseSquadModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-700 hover:from-indigo-500 hover:to-purple-600 text-white font-heading font-black text-xs tracking-wider shadow-lg shadow-indigo-500/25 border border-indigo-400/40 transition-all cursor-pointer"
            >
              <Shield className="w-4 h-4 text-indigo-200" />
              <span>🛡️ 対戦守備設定</span>
            </button>

            {/* Share / Copy Button */}
            <button
              onClick={handleShareTeam}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-all shadow-md cursor-pointer"
            >
              {copiedNotification ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">{t.copied}</span>
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4 text-slate-300" />
                  <span>{t.shareLineup}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Row B: Formation Selection & Actions */}
        <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Formation Display & Selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-300 font-mono">FORMATION:</span>
            {hasCustomPositions ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-heading font-black shadow-sm">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>カスタムフォーメーション</span>
              </div>
            ) : (
              <span className="text-xs font-mono font-bold text-emerald-400 px-1">
                {displayFormationName}
              </span>
            )}

            <div className="relative">
              <select
                disabled={isTeamLocked}
                value={formation === 'CUSTOM' ? '4-3-3' : formation}
                onChange={(e) => {
                  if (isTeamLocked) return;
                  handleFormationChange(e.target.value as FormationType);
                }}
                className={`py-1.5 pl-3 pr-8 rounded-xl bg-slate-950 text-xs font-bold border transition-all appearance-none cursor-pointer ${
                  isTeamLocked
                    ? 'border-slate-800 text-slate-500 cursor-not-allowed opacity-75'
                    : 'border-slate-700 text-white hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500'
                }`}
              >
                {PRESET_FORMATIONS.map((fKey) => (
                  <option key={fKey} value={fKey}>
                    {FORMATIONS[fKey].name}
                  </option>
                ))}
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">
                ▼
              </div>
            </div>

            {hasCustomPositions && (
              <span className="text-[10px] text-slate-400 font-mono">
                (ベース: {formation === 'CUSTOM' ? '4-3-3' : formation})
              </span>
            )}
          </div>

          {/* =========================================================================
              CRITICAL REQUIREMENT #31:
              Order strictly preserved:
              [初期配置に戻す]
              [⇄ 選手入替]
              [🔒 チームロック]
             ========================================================================= */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {/* 1. [初期配置に戻す] */}
            <button
              id="btn-reset-formation"
              disabled={isTeamLocked}
              onClick={() => {
                if (isTeamLocked) return;
                setShowResetConfirm(true);
              }}
              className={`py-1.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                isTeamLocked
                  ? 'bg-slate-950/40 border-slate-800 text-slate-600 cursor-not-allowed'
                  : 'bg-slate-950/80 hover:bg-slate-900 border-slate-700 text-rose-400 hover:text-rose-300 hover:border-rose-500/40 cursor-pointer'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>初期配置に戻す</span>
            </button>

            {/* 1.5. [⇄ 選手入替] Toggle Button */}
            <button
              id="btn-swap-mode-toggle"
              disabled={isTeamLocked}
              onClick={() => {
                if (isTeamLocked) return;
                soundManager.playButtonClick();
                setIsSwapMode((prev) => !prev);
                setSelectedSwapSourceSlotId(null);
              }}
              className={`py-1.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                isTeamLocked
                  ? 'bg-slate-950/40 border-slate-800 text-slate-600 cursor-not-allowed'
                  : isSwapMode
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white border-indigo-400 shadow-md font-black animate-pulse cursor-pointer'
                  : 'bg-slate-950/80 hover:bg-slate-900 border-slate-700 text-indigo-300 hover:border-indigo-400/60 cursor-pointer'
              }`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>{isSwapMode ? '⇄ 入替モード中' : '⇄ 選手入替'}</span>
            </button>

            {/* 2. [🔒 チームロック] */}
            <button
              id="btn-team-lock-toggle"
              onClick={handleLockClick}
              className={`py-1.5 px-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border shadow-sm transition-all cursor-pointer ${
                isTeamLocked
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black border-amber-400 shadow-amber-500/20'
                  : 'bg-slate-950/80 hover:bg-slate-900 border-slate-700 hover:border-amber-400/60 text-amber-300'
              }`}
            >
              {isTeamLocked ? (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>🔒 チームロック中 (タップで解除)</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3.5 h-3.5 text-slate-400" />
                  <span>🔒 チームロック</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Informative notices bar */}
        {lockNoticeToast && (
          <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2 animate-fadeIn">
            <Lock className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{lockNoticeToast}</span>
          </div>
        )}

        {moveErrorNotice && (
          <div className="p-2.5 rounded-xl bg-rose-950/50 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2 animate-fadeIn">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{moveErrorNotice}</span>
          </div>
        )}

        {/* Swap Mode Active Banner */}
        {isSwapMode && (
          <div className="p-3 rounded-2xl bg-gradient-to-r from-indigo-950/90 via-slate-900 to-indigo-950/90 border-2 border-indigo-500/70 shadow-lg flex items-center justify-between gap-3 animate-fadeIn">
            <div className="flex items-center gap-2.5 min-w-0">
              <ArrowLeftRight className="w-5 h-5 text-indigo-400 shrink-0 animate-pulse" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">
                  【選手入替モード】入れ替えたい2人の選手を順にタップしてください
                </div>
                <div className="text-[11px] text-indigo-300 truncate">
                  {selectedSwapSourceSlotId
                    ? '1人目を選択中。2人目の選手をタップすると2人の配置が入れ替わります'
                    : '1人目の選手をタップして選択してください'}
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                soundManager.playButtonClick();
                setIsSwapMode(false);
                setSelectedSwapSourceSlotId(null);
              }}
              className="py-1 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 shrink-0 cursor-pointer"
            >
              入替終了
            </button>
          </div>
        )}
      </div>

      {/* 3. Tactical Pitch Canvas */}
      <div
        ref={pitchRef}
        id="tactical-pitch-stage"
        onPointerMove={handleSlotPointerMove}
        className="relative w-full aspect-[4/3] sm:aspect-[16/11] max-h-[580px] bg-emerald-900/90 rounded-3xl border-4 border-emerald-600/40 shadow-2xl overflow-hidden p-2 select-none touch-none"
        style={{
          background:
            'radial-gradient(ellipse at center, #065f46 0%, #064e3b 50%, #022c22 100%)',
        }}
      >
        {/* Pitch Lines */}
        <div className="absolute inset-2 border-2 border-white/30 rounded-2xl pointer-events-none">
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white/30 -translate-y-1/2" />
          <div className="absolute top-1/2 left-1/2 w-24 h-24 sm:w-32 sm:h-32 rounded-full border-2 border-white/30 -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-white/50 -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 sm:w-64 h-16 sm:h-20 border-b-2 border-x-2 border-white/30 rounded-b-xl" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 sm:w-32 h-8 sm:h-10 border-b-2 border-x-2 border-white/30 rounded-b-lg" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-48 sm:w-64 h-16 sm:h-20 border-t-2 border-x-2 border-white/30 rounded-t-xl" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-24 sm:w-32 h-8 sm:h-10 border-t-2 border-x-2 border-white/30 rounded-t-lg" />
        </div>

        {/* Pitch Interactive Slots (11 Players) */}
        <div className="relative w-full h-full">
          {activeSlots.map((slot) => {
            const playerId = resolvedPlayerSlots[slot.id];
            const player = myTeam.find((p) => p.playerId === playerId);
            const isBeingDragged = draggingSlotId === slot.id;
            const isHoveredForSwap = hoveredSwapSlotId === slot.id;
            const isSwapSource = selectedSwapSourceSlotId === slot.id;
            const isSwapTargetCandidate =
              isSwapMode && selectedSwapSourceSlotId !== null && selectedSwapSourceSlotId !== slot.id;
            const isPressingThis = longPressingSlotId === slot.id;

            const posX = isBeingDragged && dragCoord ? dragCoord.x : slot.x;
            const posY = isBeingDragged && dragCoord ? dragCoord.y : slot.y;

            // Check if an empty slot is physically overlapped by another player on the pitch
            const isCoveredByOtherPlayer =
              !player &&
              activeSlots.some((other) => {
                if (other.id === slot.id) return false;
                const otherPlayerId = resolvedPlayerSlots[other.id];
                if (!otherPlayerId) return false;
                const otherX = draggingSlotId === other.id && dragCoord ? dragCoord.x : other.x;
                const otherY = draggingSlotId === other.id && dragCoord ? dragCoord.y : other.y;
                return Math.hypot(otherX - slot.x, otherY - slot.y) < 7.0;
              });

            // If empty slot is covered by another player and not being hovered for drop, hide it completely to prevent overlap
            if (!player && isCoveredByOtherPlayer && !isHoveredForSwap) {
              return null;
            }

            return (
              <div
                key={slot.id}
                onPointerDown={(e) => handleSlotPointerDown(slot.id, e)}
                onPointerMove={handleSlotPointerMove}
                onPointerUp={(e) => handleSlotPointerUp(slot.id, e)}
                onPointerCancel={handleSlotPointerCancel}
                onTouchStart={(e) => handleSlotTouchStart(slot.id, e)}
                onTouchMove={handleSlotTouchMove}
                onTouchEnd={(e) => handleSlotTouchEnd(slot.id, e)}
                onTouchCancel={handleSlotPointerCancel}
                style={{
                  left: `${posX}%`,
                  top: `${posY}%`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: isBeingDragged ? 50 : isHoveredForSwap || isSwapSource ? 40 : 10,
                }}
                className={`absolute cursor-pointer select-none touch-none ${
                  isBeingDragged
                    ? 'transition-none scale-115 ring-4 ring-amber-400 shadow-2xl z-50'
                    : isHoveredForSwap
                    ? 'transition-all scale-110 ring-4 ring-indigo-400 shadow-2xl animate-pulse bg-indigo-500/30 rounded-2xl z-40'
                    : isSwapSource
                    ? 'transition-all scale-110 ring-4 ring-amber-400 shadow-2xl animate-pulse bg-amber-500/30 rounded-2xl z-40'
                    : isSwapTargetCandidate
                    ? 'transition-all ring-2 ring-emerald-400 hover:scale-105 rounded-2xl'
                    : isPressingThis
                    ? 'transition-all scale-95 brightness-125'
                    : 'transition-all hover:scale-105'
                }`}
              >
                {player ? (
                  (() => {
                    const targetPos = isBeingDragged && dragCoord
                      ? getEFootballPositionFromCoords(posX, posY)
                      : customPositions[slot.id]
                      ? getEFootballPositionFromCoords(slot.x, slot.y)
                      : normalizeRoleToEFootball(slot.role);
                    const evalResult = evaluatePlayerAtPosition(player, targetPos);
                    const displayedRole = isBeingDragged && dragCoord
                      ? targetPos
                      : customPositions[slot.id]?.role || slot.role;

                    return (
                      <div
                        className={`w-14 sm:w-20 rounded-xl sm:rounded-2xl p-1 sm:p-1.5 shadow-xl border flex flex-col items-center justify-between text-center transition-all relative ${
                          isBeingDragged
                            ? 'bg-slate-900 border-amber-400 ring-2 ring-amber-400 shadow-amber-500/40'
                            : isHoveredForSwap
                            ? 'bg-indigo-950 border-indigo-400 ring-2 ring-indigo-400 shadow-indigo-500/50'
                            : isSwapSource
                            ? 'bg-amber-950/90 border-amber-400 shadow-amber-500/40'
                            : evalResult.ratingDelta < 0
                            ? 'bg-gradient-to-b from-rose-950/90 via-slate-900 to-slate-950 border-rose-500/80 shadow-rose-950/40'
                            : player.rating >= 90
                            ? 'bg-gradient-to-b from-slate-900 via-amber-950/60 to-slate-950 border-amber-500/70 shadow-amber-500/20'
                            : 'bg-gradient-to-b from-slate-900 via-slate-900/90 to-slate-950 border-emerald-500/50 shadow-emerald-950/50'
                        }`}
                      >
                        {/* Dynamic Status Badges */}
                        {isBeingDragged && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-slate-950 px-1.5 py-0.2 rounded-full text-[8px] font-black whitespace-nowrap shadow-md">
                            移動中
                          </div>
                        )}

                        {isHoveredForSwap && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white px-1.5 py-0.2 rounded-full text-[8px] font-black whitespace-nowrap shadow-md flex items-center gap-0.5">
                            <span>⇄</span>
                            <span>離して入替</span>
                          </div>
                        )}

                        {isSwapSource && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-slate-950 px-1.5 py-0.2 rounded-full text-[8px] font-black whitespace-nowrap shadow-md">
                            入替元
                          </div>
                        )}

                        {isSwapTargetCandidate && !isHoveredForSwap && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-950 px-1 py-0.2 rounded text-[7px] font-black whitespace-nowrap shadow-md">
                            タップで入替
                          </div>
                        )}

                        {/* Top flag + Rating + Penalty Tag */}
                        <div className="flex items-center justify-between w-full text-[9px] sm:text-xs">
                          <span className="leading-none">{player.nationalityFlag}</span>
                          <div className="flex items-center gap-0.5">
                            {evalResult.ratingDelta < 0 && (
                              <span className="text-[8px] font-black text-rose-400 animate-pulse font-mono">
                                {evalResult.ratingDelta}
                              </span>
                            )}
                            <span
                              className={`font-heading font-black ${
                                evalResult.ratingDelta < 0
                                  ? 'text-rose-400'
                                  : player.rating >= 90
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                              }`}
                            >
                              {evalResult.effectiveRating}
                            </span>
                          </div>
                        </div>

                        {/* Player Name */}
                        <div className="my-0.5 sm:my-1 w-full px-0.5">
                          <div className="font-heading font-bold text-[9px] sm:text-xs text-white truncate leading-tight">
                            {getLocalizedPlayerName(player, language)}
                          </div>
                          <div className="text-[7px] sm:text-[9px] text-slate-400 truncate">
                            {player.clubName}
                          </div>
                        </div>

                        {/* Role & Slot Position Pill */}
                        <div className="w-full flex items-center justify-between pt-0.5 border-t border-slate-800/80 text-[7px] sm:text-[9px] font-mono">
                          <span
                            className={`font-bold ${
                              evalResult.ratingDelta < 0 ? 'text-rose-400' : 'text-emerald-400'
                            }`}
                          >
                            {displayedRole}
                          </span>
                          <span className="text-slate-400 font-sans">{player.joiningYear}</span>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  /* Empty Slot (v1.2.5 enhanced: clear position indicator, swap candidate badges, hover glow) */
                  <div
                    className={`w-12 h-12 sm:w-16 sm:h-16 rounded-2xl border-2 flex flex-col items-center justify-center text-center transition-all relative ${
                      isHoveredForSwap
                        ? 'border-emerald-400 bg-emerald-950/80 ring-4 ring-emerald-400 shadow-2xl scale-110 animate-pulse text-emerald-200'
                        : isSwapSource
                        ? 'border-amber-400 bg-amber-950/80 ring-4 ring-amber-400 shadow-2xl scale-110 text-amber-200'
                        : isSwapTargetCandidate
                        ? 'border-emerald-500/80 bg-emerald-950/40 ring-2 ring-emerald-400 text-emerald-300 hover:scale-105'
                        : 'border-dashed border-white/30 bg-black/50 text-slate-300 hover:border-emerald-400/70 hover:bg-black/70'
                    }`}
                  >
                    {isHoveredForSwap && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-950 px-1.5 py-0.2 rounded-full text-[8px] font-black whitespace-nowrap shadow-md flex items-center gap-0.5">
                        <span>⬇</span>
                        <span>ここに移動</span>
                      </div>
                    )}

                    {isSwapSource && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-slate-950 px-1.5 py-0.2 rounded-full text-[8px] font-black whitespace-nowrap shadow-md">
                        移動元 (空き)
                      </div>
                    )}

                    {isSwapTargetCandidate && !isHoveredForSwap && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-950 px-1 py-0.2 rounded text-[7px] font-black whitespace-nowrap shadow-md">
                        タップで配置
                      </div>
                    )}

                    <span className="text-[11px] sm:text-xs font-black tracking-widest uppercase text-emerald-400">
                      {slot.role}
                    </span>
                    <span className="text-[8px] font-mono opacity-60">EMPTY</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Squad Roster Table (Clicking any player also opens PlayerDetailModal) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg space-y-3">
        <h4 className="font-heading font-bold text-sm text-slate-200 uppercase tracking-wider flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>📋</span>
            <span>
              {currentTeam?.name || `TEAM ${currentTeamNumber}`} SQUAD LIST ({myTeam.length}/11)
            </span>
          </div>
          {myTeam.length === 11 ? (
            <span className="text-xs text-amber-400 font-black px-2.5 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/30">
              COMPLETE 11 👑
            </span>
          ) : (
            <span className="text-xs text-emerald-400 font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              {t.draftInProgress}
            </span>
          )}
        </h4>

        {myTeam.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <p className="text-xs text-slate-400 font-medium">
              No players drafted for this team yet. Spin the draft roulette to begin!
            </p>
            {onContinueDraft && activeTeamId && (
              <button
                onClick={() => onContinueDraft(activeTeamId)}
                className="py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors cursor-pointer"
              >
                ⚽ START DRAFT
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {myTeam.map((p, idx) => {
              // Find matching slot if assigned
              const assignedSlotId = Object.entries(resolvedPlayerSlots).find(
                ([_, playerId]) => playerId === p.playerId
              )?.[0];
              const slot = assignedSlotId ? activeSlots.find((s) => s.id === assignedSlotId) : null;

              return (
                <div
                  key={p.playerId}
                  onClick={() => {
                    soundManager.playCardFlip();
                    setSelectedPlayerForDetail({
                      player: p,
                      role: slot?.role || p.position,
                      slotId: assignedSlotId || '',
                    });
                  }}
                  className="flex items-center justify-between p-2.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs hover:border-amber-400/60 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-slate-500 w-4">{idx + 1}</span>
                    <span className="text-base shrink-0">{p.nationalityFlag}</span>
                    <div className="min-w-0">
                      <div className="font-bold text-white group-hover:text-amber-300 leading-none truncate transition-colors">
                        {getLocalizedPlayerName(p, language)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 truncate">
                        {p.clubName} ({p.joiningYear})
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span className="font-mono font-black text-amber-400 bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-700">
                      {p.rating}
                    </span>
                    <span className="text-[10px] font-bold text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded-md">
                      {slot?.role || p.position}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. PLAYER DETAIL MODAL (Opened on ONE-TAP) */}
      <PlayerDetailModal
        player={selectedPlayerForDetail?.player || null}
        currentRole={selectedPlayerForDetail?.role}
        isOpen={Boolean(selectedPlayerForDetail)}
        onClose={() => setSelectedPlayerForDetail(null)}
        language={language}
      />

      {/* 6. UNLOCK CONFIRMATION MODAL (Requirement #31) */}
      {showUnlockConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto border border-amber-500/30">
              <Unlock className="w-6 h-6" />
            </div>

            <h3 className="font-heading font-black text-base text-white">
              チームロックを解除しますか？
            </h3>

            <p className="text-xs text-slate-300 leading-relaxed">
              ロックを解除すると、フォーメーション変更や選手の配置変更が可能になります。
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => setShowUnlockConfirm(false)}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-all cursor-pointer"
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmUnlock}
                className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black text-xs transition-all shadow-lg cursor-pointer"
              >
                ロック解除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. RESET FORMATION CONFIRMATION MODAL */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/30">
              <RotateCcw className="w-6 h-6" />
            </div>

            <h3 className="font-heading font-black text-base text-white">
              {t.resetFormationConfirmTitle}
            </h3>

            <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed">
              {t.resetFormationConfirm}
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-all cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleConfirmReset}
                className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-bold text-xs transition-all shadow-lg cursor-pointer"
              >
                {t.resetFormation}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. DELETE TEAM MODAL */}
      {teamToDelete && onDeleteTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          {(() => {
            const targetTeam = teams.find((t) => t.teamId === teamToDelete);
            const isLocked = targetTeam?.isLocked ?? false;

            if (isLocked) {
              return (
                <div className="bg-slate-900 border border-amber-500/40 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center animate-fadeIn">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto border border-amber-500/30">
                    <Lock className="w-6 h-6" />
                  </div>
                  <h3 className="font-heading font-black text-base text-white">
                    このチームはロックされています
                  </h3>
                  <p className="text-xs text-slate-300">
                    ロック中のチームは削除できません。チーム設定からロックを解除してから削除してください。
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={() => setTeamToDelete(null)}
                      className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs cursor-pointer transition-colors"
                    >
                      {t.close || '閉じる'}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
                <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/30">
                  <Trash2 className="w-6 h-6" />
                </div>
                <h3 className="font-heading font-black text-base text-white">{t.deleteTeam}</h3>
                <p className="text-xs text-slate-300">{t.deleteTeamConfirm}</p>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={() => setTeamToDelete(null)}
                    className="py-2.5 px-4 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
                  >
                    {t.cancel}
                  </button>
                  <button
                    onClick={() => {
                      if (targetTeam?.isLocked) {
                        setTeamToDelete(null);
                        return;
                      }
                      soundManager.playButtonClick();
                      onDeleteTeam(teamToDelete);
                      setTeamToDelete(null);
                    }}
                    className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md cursor-pointer"
                  >
                    {t.confirm}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* 8. Defense Squad Modal (v1.2.5 Independent Tactical & OVR Defense Squad Settings) */}
      <DefenseSquadModal
        isOpen={isDefenseSquadModalOpen}
        onClose={() => setIsDefenseSquadModalOpen(false)}
        activeTeam={
          currentTeam || {
            teamId: activeTeamId || 'team_1',
            teamNumber: currentTeamNumber,
            name: `TEAM ${currentTeamNumber}`,
            formation,
            players: myTeam,
            playerSlots: resolvedPlayerSlots,
            customPositions,
          }
        }
        teams={teams}
        language={language}
      />
    </div>
  );
};
