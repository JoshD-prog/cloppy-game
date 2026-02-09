const GOOD_COLOR = 0xabd4ce;
const BAD_COLOR = 0xd33429;
const NEUTRAL_COLOR = 0xffffff;
const OUTLINE_COLOR = 0x000000;

const rollButton = document.getElementById("roll-button");
const turnCountEl = document.getElementById("turn-count");
const statusEl = document.getElementById("status-text");
const variantNameEl = document.getElementById("variant-name");

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
  if (statusEl) statusEl.textContent = `Status: ${text}`;
}

function setCanRoll(canRoll) {
  if (rollButton) rollButton.disabled = !canRoll;
}

function showCardModal(type, cardText, card) {
  if (!gameScene || !gameScene.cardOverlay) return Promise.resolve();

  const overlay = gameScene.cardOverlay;
  overlay.setVisible(true);
  overlay.setAlpha(0);
  overlay.setScale(0.2);
  overlay.angle = -12;

  overlay.typeText.setText(type === "good" ? "Modern Advantage" : "Legacy Setback");
  overlay.titleText.setText(cardText.title);
  overlay.descText.setText(cardText.description);
  overlay.effectText.setText(describeEffect(card));
  overlay.accent.setFillStyle(type === "good" ? GOOD_COLOR : BAD_COLOR, 1);

  gameScene.tweens.add({
    targets: overlay,
    alpha: 1,
    scale: 1,
    angle: 0,
    duration: 260,
    ease: "Back.easeOut",
  });

  return new Promise((resolve) => {
    cardResolve = resolve;
  });
}

function closeCardModal() {
  if (!gameScene || !gameScene.cardOverlay) return;
  const overlay = gameScene.cardOverlay;
  gameScene.tweens.add({
    targets: overlay,
    alpha: 0,
    scale: 0.8,
    angle: 8,
    duration: 180,
    ease: "Back.easeIn",
    onComplete: () => {
      overlay.setVisible(false);
      if (cardResolve) {
        cardResolve();
        cardResolve = null;
      }
    },
  });
}

function showWin() {
  winModal.classList.remove("hidden");
}

restartButton.addEventListener("click", () => {
  winModal.classList.add("hidden");
  window.location.reload();
});

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
    backgroundColor: "#fdfcf9",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
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
    this.load.svg("cloppy", "Cloppy.svg", { width: 700, height: 700 });
  }

  function create() {
    gameScene = this;
    this.boardGraphics = this.add.graphics();
    this.boardGraphics.setDepth(1);
    this.labels = [];
    this.positions = [];

    this.cloppy = this.add.image(0, 0, "cloppy");
    this.cloppy.setOrigin(0.5, 0.9);
    this.cloppy.setDepth(4);

    this.diceGroup = this.add.container(0, 0);
    this.diceGroup.setDepth(6);
    this.diceBox = this.add.rectangle(0, 0, 56, 56, 0xffffff, 1);
    this.diceBox.setStrokeStyle(3, 0x000000, 1);
    this.diceText = this.add.text(0, 0, "-", {
      fontFamily: "Bungee",
      fontSize: 28,
      color: "#111111",
    });
    this.diceText.setOrigin(0.5);
    this.diceGroup.add([this.diceBox, this.diceText]);
    this.diceGroup.setVisible(false);

    this.cardOverlay = buildCardOverlay(this);
    this.cardOverlay.setDepth(10);
    this.cardOverlay.setVisible(false);

    drawBoard(this);

    if (turnCountEl) turnCountEl.textContent = "Turn: 0";
    updateStatus("Ready to roll");
    setCanRoll(true);
  }

  function resize(gameSize) {
    if (!gameScene) return;
    drawBoard(gameScene, gameSize.width, gameSize.height);
  }

  async function handleRoll() {
    if (!gameScene || !gameState) return;

    if (gameState.skipNextTurn) {
      gameState.skipNextTurn = false;
      gameState.turnCount += 1;
      if (turnCountEl) turnCountEl.textContent = `Turn: ${gameState.turnCount}`;
      updateStatus("Turn skipped due to legacy slowdown.");
      setCanRoll(true);
      return;
    }

    gameState.turnCount += 1;
    if (turnCountEl) turnCountEl.textContent = `Turn: ${gameState.turnCount}`;

    const roll = await rollDieAnimated();
    gameState.lastRoll = roll;

    updateStatus(`Rolled ${roll}. Moving forward.`);
    setCanRoll(false);

    const targetIndex = Math.min(gameState.currentIndex + roll, totalSpaces - 1);
    await moveToIndex(targetIndex);
    await resolveSpace();
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

  function buildCardOverlay(scene) {
    const overlay = scene.add.container(scene.scale.width / 2, scene.scale.height / 2);

    const cardWidth = Math.min(420, scene.scale.width * 0.7);
    const cardHeight = Math.min(540, scene.scale.height * 0.78);

    const shadow = scene.add.rectangle(8, 12, cardWidth, cardHeight, 0x000000, 0.2);
    shadow.setStrokeStyle(0);

    const cardBg = scene.add.rectangle(0, 0, cardWidth, cardHeight, 0xffffff, 1);
    cardBg.setStrokeStyle(3, 0x000000, 1);
    cardBg.setInteractive(new Phaser.Geom.Rectangle(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight), Phaser.Geom.Rectangle.Contains);

    const accent = scene.add.rectangle(0, -cardHeight * 0.38, cardWidth * 0.78, 12, GOOD_COLOR, 1);

    const typeText = scene.add.text(0, -cardHeight * 0.34, "Modern Advantage", {
      fontFamily: "Space Grotesk",
      fontSize: 14,
      color: "#111111",
      fontStyle: "bold",
      align: "center",
    });
    typeText.setOrigin(0.5);

    const titleText = scene.add.text(0, -cardHeight * 0.22, "Card Title", {
      fontFamily: "Bungee",
      fontSize: 22,
      color: "#111111",
      align: "center",
      wordWrap: { width: cardWidth * 0.75 },
    });
    titleText.setOrigin(0.5);

    const descText = scene.add.text(0, -cardHeight * 0.02, "Card description goes here.", {
      fontFamily: "Space Grotesk",
      fontSize: 16,
      color: "#1f2e2c",
      align: "center",
      wordWrap: { width: cardWidth * 0.78 },
    });
    descText.setOrigin(0.5);

    const effectText = scene.add.text(0, cardHeight * 0.22, "Effect: Move forward.", {
      fontFamily: "Space Grotesk",
      fontSize: 16,
      color: "#111111",
      fontStyle: "bold",
      align: "center",
      wordWrap: { width: cardWidth * 0.75 },
    });
    effectText.setOrigin(0.5);

    const buttonBg = scene.add.rectangle(0, cardHeight * 0.37, cardWidth * 0.55, 48, 0x111111, 1);
    buttonBg.setStrokeStyle(0);
    const buttonText = scene.add.text(0, cardHeight * 0.37, "Continue", {
      fontFamily: "Space Grotesk",
      fontSize: 16,
      color: "#ffffff",
      fontStyle: "bold",
    });
    buttonText.setOrigin(0.5);

    overlay.add([shadow, cardBg, accent, typeText, titleText, descText, effectText, buttonBg, buttonText]);

    overlay.shadow = shadow;
    overlay.cardBg = cardBg;
    overlay.accent = accent;
    overlay.typeText = typeText;
    overlay.titleText = titleText;
    overlay.descText = descText;
    overlay.effectText = effectText;
    overlay.buttonBg = buttonBg;
    overlay.buttonText = buttonText;

    const closeHandler = () => closeCardModal();
    cardBg.on("pointerdown", closeHandler);
    buttonBg.setInteractive(new Phaser.Geom.Rectangle(-buttonBg.width / 2, -buttonBg.height / 2, buttonBg.width, buttonBg.height), Phaser.Geom.Rectangle.Contains);
    buttonBg.on("pointerdown", closeHandler);
    buttonText.setInteractive();
    buttonText.on("pointerdown", closeHandler);

    return overlay;
  }

  async function rollDieAnimated() {
    const finalValue = rollDie();
    if (!gameScene || !gameScene.diceGroup) return finalValue;

    const spins = 10;
    let count = 0;

    return new Promise((resolve) => {
      const centerX = gameScene.scale.width / 2;
      const centerY = gameScene.scale.height / 2;
      const diceSize = Math.max(90, Math.min(160, gameScene.scale.width * 0.18));
      gameScene.diceGroup.setPosition(centerX, centerY);
      gameScene.diceBox.setSize(diceSize, diceSize);
      gameScene.diceText.setFontSize(Math.floor(diceSize * 0.6));
      gameScene.diceGroup.setScale(0.2);
      gameScene.diceGroup.setAlpha(0);
      gameScene.diceGroup.setVisible(true);
      gameScene.diceGroup.angle = 0;

      gameScene.tweens.add({
        targets: gameScene.diceGroup,
        scale: 1,
        alpha: 1,
        duration: 180,
        ease: "Back.easeOut",
      });

      gameScene.tweens.add({
        targets: gameScene.diceGroup,
        angle: { from: -12, to: 12 },
        duration: 70,
        yoyo: true,
        repeat: spins,
      });

      gameScene.time.addEvent({
        delay: 70,
        repeat: spins,
        callback: () => {
          count += 1;
          const temp = rollDie();
          gameScene.diceText.setText(temp);
          if (count >= spins) {
            gameScene.diceText.setText(finalValue);
          }
        },
      });

      gameScene.time.delayedCall(70 * (spins + 1) + 50, () => {
        gameScene.tweens.add({
          targets: gameScene.diceGroup,
          scale: 0.2,
          alpha: 0,
          duration: 160,
          ease: "Back.easeIn",
          onComplete: () => {
            gameScene.diceGroup.angle = 0;
            gameScene.diceGroup.setVisible(false);
          },
        });
        resolve(finalValue);
      });
    });
  }

  function drawBoard(scene, width = scene.scale.width, height = scene.scale.height) {
    const padding = 40;
    const usableWidth = Math.max(width - padding * 2, 200);
    const usableHeight = Math.max(height - padding * 2, 200);

    const columns = Math.min(8, Math.max(5, Math.ceil(Math.sqrt(totalSpaces))));
    const rows = Math.ceil(totalSpaces / columns);

    const cellSize = Math.min(usableWidth / columns, usableHeight / rows);
    const offsetX = (width - cellSize * columns) / 2;
    const offsetY = (height - cellSize * rows) / 2;

    scene.boardGraphics.clear();
    scene.labels.forEach((label) => label.destroy());
    scene.labels = [];
    scene.positions = [];

    for (let i = 0; i < totalSpaces; i += 1) {
      const row = Math.floor(i / columns);
      const colIndex = i % columns;
      const col = row % 2 === 0 ? colIndex : columns - 1 - colIndex;
      const x = offsetX + col * cellSize;
      const y = offsetY + (rows - 1 - row) * cellSize;

      const spaceType = boardSpaces[i];
      const color =
        spaceType === "good" ? GOOD_COLOR : spaceType === "bad" ? BAD_COLOR : NEUTRAL_COLOR;

      scene.boardGraphics.lineStyle(3, OUTLINE_COLOR, 1);
      scene.boardGraphics.fillStyle(color, 1);
      scene.boardGraphics.fillRoundedRect(x, y, cellSize * 0.95, cellSize * 0.95, 10);
      scene.boardGraphics.strokeRoundedRect(x, y, cellSize * 0.95, cellSize * 0.95, 10);

      const labelText = i === 0 ? "START" : i === totalSpaces - 1 ? "SECURE" : `${i + 1}`;
      const label = scene.add.text(x + cellSize * 0.48, y + cellSize * 0.45, labelText, {
        fontFamily: "Space Grotesk",
        fontSize: Math.max(12, Math.floor(cellSize * 0.18)),
        color: "#111111",
        fontStyle: "bold",
      });
      label.setOrigin(0.5);
      label.setDepth(3);
      scene.labels.push(label);

      scene.positions.push({ x: x + cellSize * 0.48, y: y + cellSize * 0.75 });
    }

    if (scene.cloppy) {
      const texture = scene.textures.get("cloppy");
      const source = texture?.getSourceImage?.();
      if (source && source.width) {
        const targetSize = cellSize * 0.8;
        const scale = targetSize / Math.max(source.width, source.height);
        scene.cloppy.setScale(scale);
      }
      const pos = scene.positions[gameState.currentIndex];
      scene.cloppy.setPosition(pos.x, pos.y);
    }

    if (scene.diceGroup) {
      scene.diceGroup.setVisible(false);
    }

    if (scene.cardOverlay) {
      scene.cardOverlay.setPosition(width / 2, height / 2);
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
        resolve();
        return;
      }

      const runStep = (stepIndex) => {
        if (stepIndex >= steps.length) {
          gameState.currentIndex = targetIndex;
          resolve();
          return;
        }

        const pos = gameScene.positions[steps[stepIndex]];
        gameScene.tweens.add({
          targets: gameScene.cloppy,
          x: pos.x,
          y: pos.y,
          duration: 240,
          ease: "Sine.easeInOut",
          onComplete: () => {
            gameScene.tweens.add({
              targets: gameScene.cloppy,
              y: pos.y - 14,
              duration: 120,
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
