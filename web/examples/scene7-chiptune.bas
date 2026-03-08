' Scene 7 Extended — tension & release structure
' 120 BPM, 16th notes, LP filter sweep
' Main(x4) -> Tension(x3) -> Main(x2) -> Release(x2) -> Fade

' ============ INSTRUMENTS ============

' Bass — triangle, plucky
EFFECT s7_bass
  STEP 0,   WAVE_TRI, 0, 255, 255, 0
  STEP 40,  WAVE_TRI, 0, 255, 180, 0
  STEP 100, WAVE_TRI, 0, 255, 120, 0
  STEP 250, OFF
END EFFECT

' Melody — pulse, moderate sustain
EFFECT s7_lead
  STEP 0,   WAVE_PULSE, 0, 128, 180, 0
  STEP 15,  WAVE_PULSE, 0, 128, 240, 0
  STEP 60,  WAVE_PULSE, 0, 128, 200, 0
  STEP 150, WAVE_PULSE, 0, 128, 150, 0
  STEP 300, OFF
END EFFECT

' Arp — narrow pulse, continuous
EFFECT s7_arp
  STEP 0,   WAVE_PULSE, 0, 64, 100, 0
  STEP 500, OFF
END EFFECT

' Pad — slow-attack saw
EFFECT s7_pad
  STEP 0,   WAVE_SAW, 0, 255, 40, 0
  STEP 150, WAVE_SAW, 0, 255, 100, 0
  STEP 500, WAVE_SAW, 0, 255, 130, 0
  STEP 1500, OFF
END EFFECT

' ============ SONGS ============

' ---- MAIN: original A+B pattern (64 steps, looping) ----
SONG scene7, 120, 1
  TRACK 0, s7_bass, 0, 0, "C2:2 R:2 G1:2 R:2 GS1:2 R:2 AS1:2 R:2 C2:2 R:2 DS2:2 R:2 F2:2 R:2 G1:2 R:2 C2:2 R:2 GS1:2 R:2 AS1:2 R:2 G1:2 R:2 C2:2 R:2 DS2:2 R:2 F2:2 R:2 G2:2 R:2"
  TRACK 1, s7_lead, 0, 0, "G4:1 R:1 DS4:1 R:1 C4:1 DS4:1 G4:1 R:1 GS4:1 R:1 G4:1 R:1 F4:1 R:1 DS4:1 R:1 D4:1 R:1 DS4:1 R:1 F4:1 R:1 G4:1 GS4:1 G4:1 R:1 F4:1 R:1 DS4:1 R:1 D4:1 R:1 C4:1 R:3 DS4:1 R:1 C4:1 R:1 G3:1 R:3 AS3:1 R:3 C4:1 R:1 D4:1 R:1 DS4:1 R:3 C4:1 R:3 G3:1 R:3"
  TRACK 2, s7_arp, 0, 0, "C4:1 DS4:1 G4:1 C5:1 C4:1 DS4:1 G4:1 C5:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 G3:1 B3:1 D4:1 G4:1 G3:1 B3:1 D4:1 G4:1 C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2 GS3:2 C4:2 DS4:2 GS4:2 GS3:2 C4:2 DS4:2 GS4:2"
  TRACK 3, s7_pad, 0, 0, "C3:8 GS2:8 AS2:8 G2:8 C3:8 GS2:8 AS2:8 G2:8"
  TRACK 4, s7_pad, 0, 0, "G3:8 DS3:8 F3:8 D3:8 G3:8 DS3:8 F3:8 D3:8"
END SONG

' ---- TENSION: Fm-Ab-Bb-G, driving bass, insistent lead ----
SONG scene7t, 120, 1
  ' Bass: quarter notes, last chord goes to 8ths
  TRACK 0, s7_bass, 0, 0, "F1:2 R:2 F1:2 F2:2 R:2 F1:2 R:2 F2:2 GS1:2 R:2 GS1:2 GS2:2 R:2 GS1:2 R:2 GS2:2 AS1:2 R:2 AS1:2 AS2:2 R:2 AS1:1 R:1 AS1:1 R:1 AS2:2 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1"
  ' Lead: repeated motifs, climbing register
  TRACK 1, s7_lead, 0, 0, "F4:1 GS4:1 F4:1 R:1 F4:1 C5:1 GS4:1 R:1 F4:1 GS4:1 F4:1 R:1 C5:1 GS4:1 F4:1 R:1 GS4:1 C5:1 GS4:1 R:1 GS4:1 DS5:1 C5:1 R:1 GS4:1 C5:1 DS5:1 C5:1 GS4:1 R:1 C5:1 R:1 AS4:1 D5:1 F5:1 D5:1 AS4:1 D5:1 F5:1 D5:1 AS4:1 D5:1 F5:1 D5:1 AS4:1 F5:1 D5:1 AS4:1 G4:1 B4:1 D5:1 G5:1 D5:1 B4:1 G4:1 R:1 G4:2 R:2 G4:1 R:1 G4:1 R:1"
  ' Arp: Fm-Ab-Bb-G7 arpeggios
  TRACK 2, s7_arp, 0, 0, "F3:1 GS3:1 C4:1 F4:1 F3:1 GS3:1 C4:1 F4:1 F3:1 GS3:1 C4:1 F4:1 F3:1 GS3:1 C4:1 F4:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 G3:1 B3:1 D4:1 F4:1 G3:1 B3:1 D4:1 F4:1 G3:1 B3:1 D4:1 F4:1 G3:1 B3:1 D4:1 F4:1"
  ' Pad root
  TRACK 3, s7_pad, 0, 0, "F2:16 GS2:16 AS2:16 G2:16"
  ' Pad fifth (B2 over G = major 3rd for bright tension)
  TRACK 4, s7_pad, 0, 0, "C3:16 DS3:16 F3:16 B2:16"
END SONG

' ---- RELEASE: Cm-Eb-Ab-Cm, gentle resolution ----
SONG scene7r, 120, 1
  ' Bass: long held notes
  TRACK 0, s7_bass, 0, 0, "C2:8 R:8 DS2:8 R:8 GS1:8 R:8 C2:8 R:8"
  ' Lead: descending melody, long notes
  TRACK 1, s7_lead, 0, 0, "G4:4 R:4 DS4:4 C4:4 DS4:8 C4:8 AS3:4 R:4 GS3:4 R:4 C4:8 R:8"
  ' Arp: open triads, half speed
  TRACK 2, s7_arp, 0, 0, "C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2 DS4:2 G4:2 AS4:2 DS5:2 DS4:2 G4:2 AS4:2 DS5:2 GS3:2 C4:2 DS4:2 GS4:2 GS3:2 C4:2 DS4:2 GS4:2 C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2"
  ' Pad root
  TRACK 3, s7_pad, 0, 0, "C3:16 DS3:16 GS2:16 C3:16"
  ' Pad fifth
  TRACK 4, s7_pad, 0, 0, "G3:16 AS3:16 DS3:16 G3:16"
END SONG

' ============ VOICE SETUP ============

VOLUME 100
VFILTER 3, 130, 60, FILTER_LP
VFILTER 4, 130, 60, FILTER_LP

' ============ PLAYBACK ============
' 120 BPM, 64 16th-note steps per loop = 480 frames at 60fps
CONST LL = 480

frame = 0
stp = 0
tick = 0
sect = 0

MPLAY scene7

DO
  ' ---- Section transitions ----
  ' 0: Main x2   (0-959)
  ' 1: Tension x2 (960-1919)
  ' 2: Main x2   (1920-2879)
  ' 3: Release x2 (2880-3839)
  ' 4: Fade out
  IF sect = 0 THEN
    IF frame >= LL * 2 THEN
      sect = 1
      stp = 0
      MPLAY scene7t
    END IF
  ELSEIF sect = 1 THEN
    IF frame >= LL * 4 THEN
      sect = 2
      stp = 0
      MPLAY scene7
    END IF
  ELSEIF sect = 2 THEN
    IF frame >= LL * 6 THEN
      sect = 3
      stp = 0
      MPLAY scene7r
    END IF
  ELSEIF sect = 3 THEN
    IF frame >= LL * 8 THEN
      sect = 4
      MSTOP
    END IF
  ELSEIF sect = 4 THEN
    fade = frame - LL * 8
    IF fade >= 180 THEN
      VOLUME 0
      sect = 5
    ELSE
      vol = 100 - fade * 100 DIV 180
      VOLUME vol
    END IF
  END IF

  ' ---- Step timing: 120 BPM 16th notes = 7.5 frames/step ----
  tick = tick + 8
  IF tick >= 60 THEN
    tick = tick - 60
    beat = stp MOD 8

    ' ---- Voice 5: Drums ----
    IF sect = 4 THEN
      ' Fade: no drums
    ELSEIF sect = 3 THEN
      ' Release: sparse kicks only
      IF beat = 0 THEN
        ENVELOPE 5, 0, 150, 0, 80
        VOICE 5, WAVE_NOISE, 60, 0
      END IF
    ELSEIF sect = 1 THEN
      ' Tension: busy kit with double kicks
      IF beat = 0 THEN
        ENVELOPE 5, 0, 150, 0, 80
        VOICE 5, WAVE_NOISE, 60, 0
      ELSEIF beat = 2 THEN
        ENVELOPE 5, 0, 120, 0, 60
        VOICE 5, WAVE_NOISE, 80, 0
      ELSEIF beat = 4 THEN
        ENVELOPE 5, 0, 100, 0, 60
        VOICE 5, WAVE_NOISE, 300, 0
      ELSEIF beat = 6 THEN
        ENVELOPE 5, 0, 100, 0, 60
        VOICE 5, WAVE_NOISE, 300, 0
      ELSE
        ENVELOPE 5, 0, 40, 0, 20
        VOICE 5, WAVE_NOISE, 1000, 0
      END IF
    ELSE
      ' Main: A=full kit, B=kicks only
      quiet = 0
      IF stp >= 32 THEN
        quiet = 1
      END IF
      IF quiet = 1 THEN
        IF beat = 0 THEN
          ENVELOPE 5, 0, 150, 0, 80
          VOICE 5, WAVE_NOISE, 60, 0
        END IF
      ELSE
        IF beat = 0 THEN
          ENVELOPE 5, 0, 150, 0, 80
          VOICE 5, WAVE_NOISE, 60, 0
        ELSEIF beat = 4 THEN
          ENVELOPE 5, 0, 100, 0, 60
          VOICE 5, WAVE_NOISE, 300, 0
        ELSEIF stp MOD 2 = 0 THEN
          ENVELOPE 5, 0, 40, 0, 20
          VOICE 5, WAVE_NOISE, 1000, 0
        END IF
      END IF
    END IF

    stp = (stp + 1) MOD 64
  END IF

  ' ---- Filter sweep on pad voices ----
  IF sect = 1 THEN
    ' Tension: fast sweep, high resonance
    fpos = frame MOD 96
    IF fpos < 48 THEN
      fcut = 140 + fpos * 100 DIV 48
    ELSE
      fcut = 240 - (fpos - 48) * 100 DIV 48
    END IF
    VFILTER 3, fcut, 90, FILTER_LP
    VFILTER 4, fcut, 90, FILTER_LP
  ELSEIF sect = 3 THEN
    ' Release: slow sweep, low resonance
    fpos = frame MOD 360
    IF fpos < 180 THEN
      fcut = 60 + fpos * 80 DIV 180
    ELSE
      fcut = 140 - (fpos - 180) * 80 DIV 180
    END IF
    VFILTER 3, fcut, 30, FILTER_LP
    VFILTER 4, fcut, 30, FILTER_LP
  ELSE
    ' Main: original sweep
    fpos = frame MOD 192
    IF fpos < 96 THEN
      fcut = 80 + fpos * 140 DIV 96
    ELSE
      fcut = 220 - (fpos - 96) * 140 DIV 96
    END IF
    VFILTER 3, fcut, 60, FILTER_LP
    VFILTER 4, fcut, 60, FILTER_LP
  END IF

  ' ---- Display ----
  CLEAR
  TEXT_SM "SCENE 7 CHIPTUNE", 10, 2

  IF sect = 0 THEN
    TEXT_LG "MAIN", 34, 16
  ELSEIF sect = 1 THEN
    TEXT_LG "TENSE", 30, 16
  ELSEIF sect = 2 THEN
    TEXT_LG "MAIN", 34, 16
  ELSEIF sect = 3 THEN
    TEXT_LG "EASE", 38, 16
  ELSE
    TEXT_LG "FIN", 46, 16
  END IF

  ' Step indicator
  bar = stp MOD 8
  RECT 14 + bar * 13, 50, 8, 8

  ' Beat bars
  pulse = frame MOD 30
  IF pulse < 4 THEN
    bh = 12
  ELSEIF pulse < 8 THEN
    bh = 8
  ELSE
    bh = 4
  END IF

  RECT 4, 38, 120, 1
  RECT 14, 38 - bh, 6, bh
  RECT 28, 38 - bh, 6, bh
  RECT 42, 38 - bh, 6, bh
  RECT 56, 38 - bh, 6, bh
  RECT 70, 38 - bh, 6, bh
  RECT 84, 38 - bh, 6, bh
  RECT 98, 38 - bh, 6, bh
  RECT 112, 38 - bh, 6, bh

  ' Progress bar (~67 sec total)
  secs = frame DIV 60
  IF secs > 67 THEN
    secs = 67
  END IF
  RECT 4, 36, secs, 2

  frame = frame + 1
  YIELD
LOOP
