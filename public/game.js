const GOOD_COLOR = 0xabd4ce;
const BAD_COLOR = 0xd33429;
const NEUTRAL_COLOR = 0xffffff;
const OUTLINE_COLOR = 0x000000;

const rollButton = document.getElementById("roll-button");
const turnCountEl = document.getElementById("turn-count");
const statusEl = document.getElementById("status-text");
const variantNameEl = document.getElementById("variant-name");
const stepsLeftEl = document.getElementById("steps-left");
const diceOverlayEl = document.getElementById("dice-overlay");
const diceBoxEl = document.getElementById("dice-box");
const diceValueEl = document.getElementById("dice-value");
const cardOverlayEl = document.getElementById("card-overlay");
const cardPanelEl = document.getElementById("card-panel");
const cardAccentEl = document.getElementById("card-accent");
const cardTypeEl = document.getElementById("card-type");
const cardTitleEl = document.getElementById("card-title");
const cardDescEl = document.getElementById("card-description");
const cardEffectEl = document.getElementById("card-effect");
const cardCloseEl = document.getElementById("card-close");

const winModal = document.getElementById("win-modal");
const restartButton = document.getElementById("restart");

let gameScene = null;
let gameState = null;
let cardResolve = null;

function getVariantFile() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("variant");
  if (!raw) return "variant_aa_target_16.json";
  return raw.endsWith(".json") ? raw : `${raw}.json`;
}

async function loadData() {
  const variantFile = getVariantFile();
  const variantResponse = await fetch(`data/boards/${variantFile}`);
  if (!variantResponse.ok) {
    throw new Error(`Missing variant: ${variantFile}`);
  }
  const variant = await variantResponse.json();
  const cardsResponse = await fetch("data/cards.json");
  const cards = await cardsResponse.json();
  return { variant, cards };
}

function buildDeck(deckSpec) {
  const deck = [];
  deckSpec.forEach((entry) => {
    for (let i = 0; i < entry.count; i += 1) {
      deck.push({ id: entry.id, params: entry.params || {}, pinLast: !!entry.pin_last });
    }
  });
  return deck;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function drawCard(deckState) {
  if (deckState.deck.length === 0) {
    deckState.deck = shuffle(deckState.original.slice());
  }

  let card = deckState.deck.shift();
  if (card.pinLast) {
    deckState.deck.push(card);
    card = deckState.deck.shift();
  }

  return card;
}

function pickCardText(cards, type, id) {
  const typePool = cards[type] || {};
  const options = typePool[id] || typePool.generic || [];
  if (options.length === 0) {
    return { title: "Pipeline Surprise", description: "A shift in the pipeline changes your pace." };
  }
  return options[Math.floor(Math.random() * options.length)];
}

function describeEffect(card) {
  switch (card.id) {
    case "go_to_end":
      return "Effect: Go to the secure end.";
    case "go_to_start":
      return "Effect: Return to start.";
    case "lose_turn":
      return "Effect: Lose your next turn.";
    case "extra_turn":
      return "Effect: Take another turn.";
    case "roll_forward":
      return "Effect: Roll and move forward.";
    case "jump_forward":
      return `Effect: Move forward ${card.params.steps}.`;
    case "go_back":
      return `Effect: Move back ${card.params.steps}.`;
    default:
      return "Effect: Adjust your position.";
  }
}

function updateStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function updateStepsLeft() {
  if (!stepsLeftEl || !gameState) return;
  const remaining = Math.max(0, gameState.totalSpaces - 1 - gameState.currentIndex);
  stepsLeftEl.textContent = `${remaining}`;
}

function setCanRoll(canRoll) {
  if (rollButton) rollButton.disabled = !canRoll;
}

function showCardModal(type, cardText, card) {
  if (!cardOverlayEl || !cardPanelEl) return Promise.resolve();

  cardTypeEl.textContent = type === "good" ? "Modern Advantage" : "Legacy Setback";
  cardTitleEl.textContent = cardText.title;
  cardDescEl.textContent = cardText.description;
  cardEffectEl.textContent = describeEffect(card);
  cardAccentEl.style.background = type === "good" ? "#abd4ce" : "#d33429";

  cardOverlayEl.classList.remove("hidden");
  cardOverlayEl.style.display = "flex";
  cardOverlayEl.style.pointerEvents = "auto";
  cardOverlayEl.dataset.closing = "false";

  cardPanelEl.animate(
    [
      { transform: "scale(0.2) rotate(-12deg)", opacity: 0 },
      { transform: "scale(1) rotate(0deg)", opacity: 1 },
    ],
    { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" }
  );

  return new Promise((resolve) => {
    cardResolve = resolve;
  });
}

function closeCardModal() {
  if (!cardOverlayEl || !cardPanelEl) return;
  if (cardOverlayEl.dataset.closing === "true") return;
  cardOverlayEl.dataset.closing = "true";

  const anim = cardPanelEl.animate(
    [
      { transform: "scale(1) rotate(0deg)", opacity: 1 },
      { transform: "scale(0.8) rotate(8deg)", opacity: 0 },
    ],
    { duration: 180, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }
  );

  anim.onfinish = () => {
    cardOverlayEl.classList.add("hidden");
    cardOverlayEl.style.display = "none";
    cardOverlayEl.dataset.closing = "false";
    if (cardResolve) {
      cardResolve();
      cardResolve = null;
    }
  };
}

function showWin() {
  winModal.classList.remove("hidden");
}

restartButton.addEventListener("click", () => {
  winModal.classList.add("hidden");
  window.location.reload();
});

if (cardCloseEl) {
  cardCloseEl.addEventListener("click", (event) => {
    event.stopPropagation();
    closeCardModal();
  });
}
if (cardOverlayEl) {
  cardOverlayEl.addEventListener("click", (event) => {
    if (event.target === cardOverlayEl) {
      closeCardModal();
    }
  });
}

function createGame(data) {
  const { variant, cards } = data;
  variantNameEl.textContent = variant.name || "Custom Variant";

  const boardSpaces = variant.board.spaces;
  const totalSpaces = boardSpaces.length;

  gameState = {
    cards,
    variant,
    boardSpaces,
    totalSpaces,
    currentIndex: 0,
    turnCount: 0,
    lastRoll: null,
    skipNextTurn: false,
    extraTurn: false,
    isRolling: false,
    goodDeck: {
      original: buildDeck(variant.good_deck.cards),
      deck: [],
    },
    badDeck: {
      original: buildDeck(variant.bad_deck.cards),
      deck: [],
    },
  };

  gameState.goodDeck.deck = shuffle(gameState.goodDeck.original.slice());
  gameState.badDeck.deck = shuffle(gameState.badDeck.original.slice());

  const config = {
    type: Phaser.AUTO,
    parent: "game-root",
    transparent: true,
    backgroundColor: "rgba(0,0,0,0)",
    dom: {
      createContainer: true,
    },
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false,
    },
    resolution: Math.min(window.devicePixelRatio || 1, 4),
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: 1100,
      height: 720,
    },
    scene: {
      preload,
      create,
      resize,
    },
  };

  new Phaser.Game(config);

  function preload() {
    // Cloppy is rendered as a live SVG DOM element for crisp edges.
  }

  function create() {
    gameScene = this;
    if (this.sys?.domContainer) {
      const dc = this.sys.domContainer;
      dc.style.pointerEvents = "auto";
      dc.style.zIndex = "2";
      dc.style.position = "absolute";
      dc.style.top = "0";
      dc.style.left = "0";
      dc.style.width = "100%";
      dc.style.height = "100%";
    }
    this.decorGraphics = this.add.graphics();
    this.decorGraphics.setDepth(0);
    this.boardGraphics = this.add.graphics();
    this.boardGraphics.setDepth(1);
    this.labels = [];
    this.positions = [];

    this.cloppy = this.add.dom(0, 0, "img");
    this.cloppy.setOrigin(0.5, 0.9);
    this.cloppy.setDepth(4);
    this.cloppy.setScrollFactor(1);
    this.cloppy.node.src = "Cloppy.svg";
    this.cloppy.node.alt = "Cloppy";
    this.cloppy.node.style.pointerEvents = "none";
    this.cloppy.node.style.imageRendering = "auto";

    // Dice and cards are HTML elements over the canvas.

    applyHiDPI(this, this.scale.width, this.scale.height);
    drawBoard(this);

    if (turnCountEl) turnCountEl.textContent = "0";
    updateStepsLeft();
    updateStatus("Ready to roll");
    setCanRoll(true);
  }

  function resize(gameSize) {
    if (!gameScene) return;
    applyHiDPI(gameScene, gameSize.width, gameSize.height);
    drawBoard(gameScene, gameSize.width, gameSize.height);
  }

  async function handleRoll() {
    if (!gameScene || !gameState) return;
    if (gameState.isRolling) return;
    gameState.isRolling = true;
    setCanRoll(false);

    try {
      if (gameState.skipNextTurn) {
        gameState.skipNextTurn = false;
        gameState.turnCount += 1;
        if (turnCountEl) turnCountEl.textContent = `${gameState.turnCount}`;
        updateStatus("Turn skipped due to legacy slowdown.");
        setCanRoll(true);
        return;
      }

      gameState.turnCount += 1;
      if (turnCountEl) turnCountEl.textContent = `${gameState.turnCount}`;

      const roll = await rollDieAnimated();
      gameState.lastRoll = roll;

      updateStatus(`Rolled ${roll}. Moving forward.`);

      const targetIndex = Math.min(gameState.currentIndex + roll, totalSpaces - 1);
      await moveToIndex(targetIndex);
      await resolveSpace();
    } finally {
      gameState.isRolling = false;
    }
  }

  if (rollButton) rollButton.addEventListener("click", handleRoll);

  async function resolveSpace() {
    if (gameState.currentIndex >= totalSpaces - 1) {
      updateStatus("Arrived in the secure environment!");
      showWin();
      setCanRoll(false);
      return;
    }

    const spaceType = boardSpaces[gameState.currentIndex];
    if (spaceType === "good" || spaceType === "bad") {
      const deckState = spaceType === "good" ? gameState.goodDeck : gameState.badDeck;
      const card = drawCard(deckState);
      const cardText = pickCardText(cards, spaceType, card.id);
      await showCardModal(spaceType, cardText, card);
      await applyCardEffect(card);
      return;
    }

    updateStatus("Steady progress. Roll again.");
    setCanRoll(true);
  }

  async function applyCardEffect(card) {
    switch (card.id) {
      case "go_to_end":
        updateStatus("Fast track activated.");
        await moveToIndex(totalSpaces - 1);
        updateStatus("Arrived in the secure environment!");
        showWin();
        setCanRoll(false);
        return;
      case "go_to_start":
        updateStatus("Security reset. Returning to start.");
        await moveToIndex(0);
        setCanRoll(true);
        return;
      case "lose_turn":
        updateStatus("Legacy slowdown: next turn skipped.");
        gameState.skipNextTurn = true;
        setCanRoll(true);
        return;
      case "extra_turn":
        updateStatus("Momentum gained. Extra turn ready.");
        setCanRoll(true);
        return;
      case "roll_forward":
        updateStatus("Auto-promotion! Rolling forward.");
        const roll = rollDie();
        await moveToIndex(Math.min(gameState.currentIndex + roll, totalSpaces - 1));
        if (gameState.currentIndex >= totalSpaces - 1) {
          updateStatus("Arrived in the secure environment!");
          showWin();
          setCanRoll(false);
          return;
        }
        setCanRoll(true);
        return;
      case "jump_forward":
        updateStatus("Pipeline boost!");
        await moveToIndex(Math.min(gameState.currentIndex + card.params.steps, totalSpaces - 1));
        if (gameState.currentIndex >= totalSpaces - 1) {
          updateStatus("Arrived in the secure environment!");
          showWin();
          setCanRoll(false);
          return;
        }
        setCanRoll(true);
        return;
      case "go_back":
        updateStatus("Setback encountered.");
        await moveToIndex(Math.max(gameState.currentIndex - card.params.steps, 0));
        setCanRoll(true);
        return;
      default:
        updateStatus("Pipeline shifts. Roll again.");
        setCanRoll(true);
    }
  }

  function rollDie() {
    return Math.floor(Math.random() * 6) + 1;
  }

  async function rollDieAnimated() {
    const finalValue = rollDie();
    if (!diceOverlayEl || !diceBoxEl || !diceValueEl) return finalValue;

    const spins = 10;
    let count = 0;
    let finalLocked = false;

    return new Promise((resolve) => {
      const diceSize = Math.max(90, Math.min(160, gameScene.scale.width * 0.18));
      diceBoxEl.style.width = `${diceSize}px`;
      diceBoxEl.style.height = `${diceSize}px`;
      diceBoxEl.style.borderRadius = `${Math.max(12, diceSize * 0.18)}px`;
      diceValueEl.style.fontSize = `${Math.floor(diceSize * 0.6)}px`;
      diceOverlayEl.classList.remove("hidden");
      diceOverlayEl.style.display = "flex";

      diceBoxEl.animate(
        [
          { transform: "scale(0.2) rotate(0deg)", opacity: 0 },
          { transform: "scale(1) rotate(0deg)", opacity: 1 },
        ],
        { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" }
      );

      const wiggle = diceBoxEl.animate(
        [
          { transform: "scale(1) rotate(-12deg)" },
          { transform: "scale(1) rotate(12deg)" },
        ],
        { duration: 70, direction: "alternate", iterations: spins * 2, easing: "ease-in-out" }
      );

      const interval = setInterval(() => {
        count += 1;
        const temp = rollDie();
        diceValueEl.textContent = `${temp}`;
        if (count >= spins && !finalLocked) {
          finalLocked = true;
          diceValueEl.textContent = `${finalValue}`;
          wiggle.cancel();
          diceBoxEl.style.transform = "scale(1) rotate(0deg)";
          clearInterval(interval);
        }
      }, 70);

      const holdMs = 350;
      setTimeout(() => {
        clearInterval(interval);
        wiggle.cancel();
        diceBoxEl.animate(
          [
            { transform: "scale(1) rotate(0deg)", opacity: 1 },
            { transform: "scale(0.2) rotate(0deg)", opacity: 0 },
          ],
          { duration: 160, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }
        ).onfinish = () => {
          diceOverlayEl.classList.add("hidden");
          diceOverlayEl.style.display = "none";
        };
        resolve(finalValue);
      }, 70 * (spins + 1) + 50 + holdMs);
    });
  }

  function applyHiDPI(scene, width, height) {
    if (!scene?.sys?.game) return;
    const game = scene.sys.game;
    const renderer = game.renderer;
    const canvas = game.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 4);

    if (renderer) {
      if (renderer.resolution !== dpr) {
        renderer.resolution = dpr;
      }
      renderer.resize(width, height);
    } else if (canvas) {
      const nextWidth = Math.floor(width * dpr);
      const nextHeight = Math.floor(height * dpr);
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
    }

    if (canvas) {
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    game.config.resolution = dpr;
  }

  function getCameraScrollFor(target, camera) {
    if (!target || !camera) return { x: 0, y: 0 };
    const bounds = camera.bounds;
    const fallbackWidth = gameState?.worldWidth || camera.width;
    const fallbackHeight = gameState?.worldHeight || camera.height;
    const fallbackX = gameState?.worldOffsetX || 0;
    const fallbackY = gameState?.worldOffsetY || 0;
    const minX = bounds ? bounds.x : fallbackX;
    const maxX = bounds
      ? Math.max(bounds.x, bounds.x + bounds.width - camera.width)
      : Math.max(fallbackX, fallbackX + fallbackWidth - camera.width);
    const minY = bounds ? bounds.y : fallbackY;
    const maxY = bounds
      ? Math.max(bounds.y, bounds.y + bounds.height - camera.height)
      : Math.max(fallbackY, fallbackY + fallbackHeight - camera.height);
    const desiredX = Phaser.Math.Clamp(target.x - camera.width / 2, minX, maxX);
    const desiredY = Phaser.Math.Clamp(target.y - camera.height / 2, minY, maxY);
    return { x: desiredX, y: desiredY };
  }

  function drawBoard(scene, width = scene.scale.width, height = scene.scale.height) {
    const tileSize = Math.round(Math.max(90, Math.min(140, height * 0.22)));
    const stepRun = tileSize * 1.12;
    const stepRise = tileSize * 0.25;
    const padding = tileSize * 0.9;

    const rawPositions = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < totalSpaces; i += 1) {
      const centerX = i * stepRun;
      const centerY = -i * stepRise;
      rawPositions.push({ x: centerX, y: centerY });
      minX = Math.min(minX, centerX - tileSize * 0.5);
      maxX = Math.max(maxX, centerX + tileSize * 0.5);
      minY = Math.min(minY, centerY - tileSize * 0.5);
      maxY = Math.max(maxY, centerY + tileSize * 0.5);
    }

    const shiftX = padding - minX;
    const shiftY = padding - minY;
    const worldWidth = maxX + shiftX + padding;
    const worldHeight = maxY + shiftY + padding;
    const cameraPad = tileSize * 2.2;
    gameState.worldWidth = worldWidth + cameraPad * 2;
    gameState.worldHeight = worldHeight + cameraPad * 2;
    gameState.worldOffsetX = -cameraPad;
    gameState.worldOffsetY = -cameraPad;

    if (scene.decorGraphics) {
      scene.decorGraphics.clear();
    }
    if (scene.boardGraphics) {
      scene.boardGraphics.clear();
    }
    scene.labels.forEach((label) => label.destroy());
    scene.labels = [];
    scene.positions = [];

    const shadowOffset = tileSize * 0.05;
    const shadowAlpha = 0.12;
    const cornerRadius = Math.round(tileSize * 0.14);

    for (let i = 0; i < totalSpaces; i += 1) {
      const centerX = rawPositions[i].x + shiftX;
      const centerY = rawPositions[i].y + shiftY;
      const x = centerX - tileSize * 0.5;
      const y = centerY - tileSize * 0.5;

      const spaceType = boardSpaces[i];
      const color =
        spaceType === "good" ? GOOD_COLOR : spaceType === "bad" ? BAD_COLOR : NEUTRAL_COLOR;

      if (scene.decorGraphics) {
        scene.decorGraphics.fillStyle(0x000000, shadowAlpha);
        scene.decorGraphics.fillRoundedRect(
          x + shadowOffset,
          y + shadowOffset,
          tileSize,
          tileSize,
          cornerRadius
        );
      }

      scene.boardGraphics.lineStyle(4, OUTLINE_COLOR, 1);
      scene.boardGraphics.fillStyle(color, 1);
      scene.boardGraphics.fillRoundedRect(x, y, tileSize, tileSize, cornerRadius);
      scene.boardGraphics.strokeRoundedRect(x, y, tileSize, tileSize, cornerRadius);

      const labelText = i === 0 ? "START" : i === totalSpaces - 1 ? "DEPLOYED" : `${i + 1}`;
      const label = scene.add.text(centerX, centerY, labelText, {
        fontFamily: "Space Grotesk",
        fontSize: Math.max(12, Math.floor(tileSize * 0.18)),
        color: "#111111",
        fontStyle: "bold",
      });
      label.setOrigin(0.5);
      label.setDepth(3);
      scene.labels.push(label);

      scene.positions.push({ x: centerX, y: centerY - tileSize * 0.39 });
    }

    gameState.tileSize = tileSize;

    if (scene.cloppy) {
      const targetSize = tileSize * 1.25;
      updateCloppySize(scene, targetSize);
      const pos = scene.positions[gameState.currentIndex];
      scene.cloppy.setPosition(pos.x, pos.y);
    }

    const camera = scene.cameras.main;
    if (camera) {
      camera.setBounds(gameState.worldOffsetX, gameState.worldOffsetY, gameState.worldWidth, gameState.worldHeight);
    }
    const currentPos = scene.positions[gameState.currentIndex];
    if (currentPos && camera) {
      const scroll = getCameraScrollFor(currentPos, camera);
      camera.setScroll(scroll.x, scroll.y);
    }

    // Dice and cards are HTML overlays handled outside Phaser.

    drawDecorations(scene, tileSize);
  }

  function updateCloppySize(scene, targetSize) {
    if (!scene.cloppy?.node) return;
    const size = Math.round(targetSize);
    if (gameState.cloppyTextureSize === size) return;
    scene.cloppy.node.style.width = `${size}px`;
    scene.cloppy.node.style.height = `${size}px`;
    if (scene.cloppy.updateSize) {
      scene.cloppy.updateSize();
    }
    scene.cloppy.setOrigin(0.5, 0.9);
    gameState.cloppyTextureSize = size;
  }

  function drawDecorations(scene, tileSize) {
    if (!scene.decorGraphics || scene.positions.length === 0) return;
    const g = scene.decorGraphics;
    const startPos = scene.positions[0];
    const endPos = scene.positions[scene.positions.length - 1];

    // Start decoration removed per request.

    if (endPos) {
      const balloonBaseX = endPos.x - tileSize * 0.3;
      const balloonBaseY = endPos.y - tileSize * 1.25;
      const colors = [0xd33429, 0xabd4ce, 0x78b5b0];
      colors.forEach((color, idx) => {
        const offsetX = (idx - 1) * tileSize * 0.22;
        const offsetY = idx * tileSize * -0.05;
        g.lineStyle(2, 0x111111, 1);
        g.fillStyle(color, 1);
        g.fillEllipse(
          balloonBaseX + offsetX,
          balloonBaseY + offsetY,
          tileSize * 0.28,
          tileSize * 0.34
        );
        g.strokeEllipse(
          balloonBaseX + offsetX,
          balloonBaseY + offsetY,
          tileSize * 0.28,
          tileSize * 0.34
        );
        g.lineBetween(
          balloonBaseX + offsetX,
          balloonBaseY + offsetY + tileSize * 0.18,
          endPos.x - tileSize * 0.1,
          endPos.y - tileSize * 0.1
        );
      });
    }
  }

  function moveToIndex(targetIndex) {
    return new Promise((resolve) => {
      if (targetIndex === gameState.currentIndex) {
        resolve();
        return;
      }

      const steps = [];
      const direction = targetIndex > gameState.currentIndex ? 1 : -1;
      for (let i = gameState.currentIndex + direction; direction > 0 ? i <= targetIndex : i >= targetIndex; i += direction) {
        steps.push(i);
      }

      if (steps.length === 0) {
        gameState.currentIndex = targetIndex;
        updateStepsLeft();
        resolve();
        return;
      }

      const baseArc = Math.max(24, (gameState.tileSize || 100) * 0.38);
      const baseSettle = Math.max(10, (gameState.tileSize || 100) * 0.12);
      const moveDuration = 260;
      const settleDuration = 120;
      const totalDuration = steps.length * (moveDuration + settleDuration);
      const cameraDelay = Math.min(260, Math.max(80, totalDuration * 0.25));

      if (gameScene?.cameras?.main) {
        const camera = gameScene.cameras.main;
        if (!camera.bounds || !camera.bounds.width) {
          const w = gameState.worldWidth || camera.width;
          const h = gameState.worldHeight || camera.height;
          const x = gameState.worldOffsetX || 0;
          const y = gameState.worldOffsetY || 0;
          camera.setBounds(x, y, w, h);
        }
        let targetPos = gameScene.positions[targetIndex];
        if (targetPos && targetIndex >= gameState.totalSpaces - 1 && gameScene.decorGraphics) {
          const tile = gameState.tileSize || 100;
          targetPos = {
            x: targetPos.x + tile * 0.25,
            y: targetPos.y - tile * 0.6,
          };
        }
        if (targetPos) {
          const scroll = getCameraScrollFor(targetPos, camera);
          gameScene.tweens.add({
            targets: camera,
            scrollX: scroll.x,
            scrollY: scroll.y,
            duration: Math.max(240, totalDuration - cameraDelay),
            ease: "Sine.easeInOut",
            delay: cameraDelay,
          });
        }
      }

      const runStep = (stepIndex) => {
        if (stepIndex >= steps.length) {
          gameState.currentIndex = targetIndex;
          updateStepsLeft();
          resolve();
          return;
        }

        const pos = gameScene.positions[steps[stepIndex]];
        const variance = Phaser.Math.FloatBetween(0.85, 1.2);
        const arcHeight = baseArc * variance;
        const settleHeight = baseSettle * (arcHeight / baseArc);
        const startX = gameScene.cloppy.x;
        const startY = gameScene.cloppy.y;
        const tweenState = { t: 0 };

        gameScene.tweens.add({
          targets: tweenState,
          t: 1,
          duration: moveDuration,
          ease: "Sine.easeInOut",
          onUpdate: () => {
            const t = tweenState.t;
            const x = Phaser.Math.Linear(startX, pos.x, t);
            const y =
              Phaser.Math.Linear(startY, pos.y, t) -
              arcHeight * 4 * t * (1 - t);
            gameScene.cloppy.setPosition(x, y);
          },
          onComplete: () => {
            gameScene.cloppy.setPosition(pos.x, pos.y);
            gameScene.tweens.add({
              targets: gameScene.cloppy,
              y: pos.y - settleHeight,
              duration: settleDuration,
              yoyo: true,
              ease: "Sine.easeOut",
              onComplete: () => runStep(stepIndex + 1),
            });
          },
        });
      };

      runStep(0);
    });
  }
}

loadData()
  .then(createGame)
  .catch((err) => {
    updateStatus("Failed to load data.");
    console.error(err);
  });
