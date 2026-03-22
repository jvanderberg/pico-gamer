' Digital Horizon - 6 Voice Chiptune Demo
' Key: C minor | 138 BPM | ~2 minutes
' Structure: Intro - Verse - Chorus - Bridge - Final Chorus - Fin

' ============ INSTRUMENTS ============

' Bass - punchy saw with filter sweep
EFFECT bass
  STEP 0,   WAVE_SAW, 0, 255, 220, 80
  STEP 60,  WAVE_SAW, 0, 255, 180, 60
  STEP 120, WAVE_SAW, 0, 255, 120, 40
  STEP 200, OFF
END EFFECT

' Lead - bright pulse with sustain
EFFECT lead
  STEP 0,   WAVE_PULSE, 0, 96, 240, 200
  STEP 30,  WAVE_PULSE, 0, 96, 210, 180
  STEP 80,  WAVE_PULSE, 0, 96, 185, 160
  STEP 160, WAVE_PULSE, 0, 96, 155, 140
  STEP 300, OFF
END EFFECT

' Pad - soft triangle
EFFECT pad
  STEP 0,   WAVE_TRI, 0, 255, 140, 0
  STEP 100, WAVE_TRI, 0, 255, 120, 0
  STEP 400, WAVE_TRI, 0, 255, 80, 0
  STEP 600, OFF
END EFFECT

' Arp - short plucky pulse
EFFECT arp
  STEP 0,   WAVE_PULSE, 0, 48, 190, 160
  STEP 25,  WAVE_PULSE, 0, 48, 130, 120
  STEP 55,  OFF
END EFFECT

' Hi-hat - short noise burst
EFFECT hat
  STEP 0,   WAVE_NOISE, 0, 255, 160, 0
  STEP 20,  WAVE_NOISE, 0, 255, 50, 0
  STEP 45,  OFF
END EFFECT

' Kick - triangle pitch sweep down
EFFECT kick
  STEP 0,   WAVE_TRI, 2400, 255, 240, 0
  STEP 12,  WAVE_TRI, 1200, 255, 200, 0
  STEP 25,  WAVE_TRI, 0, 255, 100, 0
  STEP 55,  OFF
END EFFECT

' ============ SONGS ============
' Verse chords: Cm - Ab - Bb - Cm (8 bars, 32 beats)
' Chorus chords: Ab - Bb - Cm - G  (8 bars, 32 beats)
' Bridge chords: Fm - Cm - Ab - Bb (8 bars, 32 beats)

' ---- INTRO: bass + pad + arp (no drums, no lead) ----
SONG intro_s, 138, 0
  TRACK 0, bass, 0, 0, "C2:6 C3:2 C2:6 C3:2 C2:6 C3:2 C2:6 C3:2 GS1:6 GS2:2 GS1:6 GS2:2 GS1:6 GS2:2 GS1:6 GS2:2 AS1:6 AS2:2 AS1:6 AS2:2 AS1:6 AS2:2 AS1:6 AS2:2 C2:6 C3:2 C2:6 C3:2 C2:6 C3:2 C2:6 C3:2"
  TRACK 2, pad, 0, 0, "DS3:16 G3:16 C3:16 DS3:16 D3:16 F3:16 DS3:16 G3:16"
  TRACK 3, arp, 0, 0, "C4:4 DS4:4 G4:4 DS4:4 C4:4 G4:4 DS4:4 C4:4 GS3:4 C4:4 DS4:4 C4:4 GS3:4 DS4:4 C4:4 GS3:4 AS3:4 D4:4 F4:4 D4:4 AS3:4 F4:4 D4:4 AS3:4 C4:4 DS4:4 G4:4 DS4:4 C4:4 G4:4 DS4:4 C4:4"
END SONG

' ---- VERSE: full band (loops) ----
SONG verse_s, 138, 1
  TRACK 0, bass, 0, 0, "C2:6 C3:2 C2:6 C3:2 C2:6 C3:2 C2:6 C3:2 GS1:6 GS2:2 GS1:6 GS2:2 GS1:6 GS2:2 GS1:6 GS2:2 AS1:6 AS2:2 AS1:6 AS2:2 AS1:6 AS2:2 AS1:6 AS2:2 C2:6 C3:2 C2:6 C3:2 C2:6 C3:2 C2:6 C3:2"
  TRACK 1, lead, 320, 8, "R:4 G3:4 C4:4 DS4:4 D4:4 C4:4 DS4:4 G4:4 G4:4 F4:4 DS4:4 C4:4 D4:4 DS4:4 C4:4 R:4 AS3:4 C4:4 D4:4 F4:4 DS4:4 D4:4 C4:4 AS3:4 C4:4 DS4:4 D4:4 C4:4 AS3:4 G3:4 C4:8"
  TRACK 2, pad, 0, 0, "DS3:16 G3:16 C3:16 DS3:16 D3:16 F3:16 DS3:16 G3:16"
  TRACK 3, arp, 0, 0, "C4:4 DS4:4 G4:4 DS4:4 C4:4 G4:4 DS4:4 C4:4 GS3:4 C4:4 DS4:4 C4:4 GS3:4 DS4:4 C4:4 GS3:4 AS3:4 D4:4 F4:4 D4:4 AS3:4 F4:4 D4:4 AS3:4 C4:4 DS4:4 G4:4 DS4:4 C4:4 G4:4 DS4:4 C4:4"
  TRACK 4, hat, 0, 0, "C6:4 R:4 C6:4 C6:4 C6:4 R:4 C6:4 C6:4 C6:4 R:4 C6:4 C6:4 C6:4 R:4 C6:4 C6:4 C6:4 R:4 C6:4 C6:4 C6:4 R:4 C6:4 C6:4 C6:4 R:4 C6:4 C6:4 C6:4 R:4 C6:4 C6:4"
  TRACK 5, kick, 0, 0, "C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4"
END SONG

' ---- CHORUS: energetic melody (loops) ----
SONG chorus_s, 138, 1
  TRACK 0, bass, 0, 0, "GS1:6 GS2:2 GS1:6 GS2:2 GS1:6 GS2:2 GS1:6 GS2:2 AS1:6 AS2:2 AS1:6 AS2:2 AS1:6 AS2:2 AS1:6 AS2:2 C2:6 C3:2 C2:6 C3:2 C2:6 C3:2 C2:6 C3:2 G1:6 G2:2 G1:6 G2:2 G1:6 G2:2 G1:6 G2:2"
  TRACK 1, lead, 320, 8, "DS4:4 G4:4 DS4:4 C4:4 DS4:8 G4:8 AS4:4 G4:4 AS4:4 G4:4 F4:4 DS4:4 F4:8 G4:4 AS4:4 G4:4 F4:4 G4:8 DS4:8 C4:4 DS4:4 F4:4 G4:4 AS4:4 G4:12"
  TRACK 2, pad, 0, 0, "C3:16 DS3:16 D3:16 F3:16 DS3:16 G3:16 D3:16 G3:16"
  TRACK 3, arp, 0, 0, "GS3:4 C4:4 DS4:4 C4:4 GS3:4 DS4:4 C4:4 GS3:4 AS3:4 D4:4 F4:4 D4:4 AS3:4 F4:4 D4:4 AS3:4 C4:4 DS4:4 G4:4 DS4:4 C4:4 G4:4 DS4:4 C4:4 G3:4 AS3:4 D4:4 AS3:4 G3:4 D4:4 AS3:4 G3:4"
  TRACK 4, hat, 0, 0, "C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4"
  TRACK 5, kick, 0, 0, "C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4"
END SONG

' ---- BRIDGE: Fm - Bb - Ab - G, builds to final chorus ----
' Same rhythmic style as verse/chorus. Bass drops first 8 beats, returns light.
' Lead melody steps through the new chords. G dominant at the end pulls to Cm.
SONG bridge_s, 138, 0
  TRACK 0, bass, 0, 0, "F1:4 F2:4 F1:4 F2:4 F1:4 F2:4 F1:4 F2:4 AS1:4 AS2:4 AS1:4 AS2:4 GS1:4 GS2:4 GS1:4 GS2:4 G1:4 G2:4 G1:4 G2:4 G1:4 G2:4 G1:4 G2:4"
  TRACK 1, lead, 0, 8, "F4:4 GS4:4 C5:4 GS4:4 F4:4 DS4:4 F4:4 GS4:4 GS4:4 DS4:4 C4:4 DS4:4 G4:4 B3:4 D4:4 G4:4 G4:4 D4:4 B3:4 D4:4 F4:4 DS4:4 D4:4 G4:4 G4:2 AS4:2 G4:4 D4:4 G4:4 B3:4 D4:4 G4:4"
  TRACK 3, arp, 0, 0, "F3:4 GS3:4 C4:4 GS3:4 F3:4 C4:4 GS3:4 F3:4 AS3:4 D4:4 F4:4 D4:4 GS3:4 C4:4 DS4:4 C4:4 G3:4 B3:4 D4:4 B3:4 G3:4 D4:4 B3:4 G3:4 G3:4 B3:4 D4:4 B3:4 G3:4 D4:4 B3:4 G3:4"
  TRACK 4, hat, 0, 0, "R:4 C6:4 R:4 C6:4 R:4 C6:4 R:4 C6:4 C6:4 R:4 C6:4 C6:4 C6:4 R:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4 C6:4"
  TRACK 5, kick, 0, 0, "R:4 R:4 C2:4 R:4 R:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4 C2:4 R:4"
END SONG

' ============ VOICE SETUP ============

VOLUME 176

' Voice 0: Bass - warm saw
VFILTER 0, 80, 50, FILTER_LP
VDRIVE 0, 64

' Voice 1: Lead - bright pulse
VFILTER 1, 200, 20, FILTER_LP
VDRIVE 1, 80

' Voice 2: Pad - clean triangle
VFILTER 2, 220, 10, FILTER_LP

' Voice 3: Arp - tight filtered pulse
VFILTER 3, 160, 30, FILTER_LP
VDRIVE 3, 48

' Voice 4: Hi-hat - noise through HP
VFILTER 4, 200, 20, FILTER_HP

' Voice 5: Kick - low punch
VFILTER 5, 240, 10, FILTER_LP

' Master filter - slight warmth
FILTER 210, 8, FILTER_LP

' ============ PLAYBACK ============

' 138 BPM at 60fps: 32 beats = 835 frames, 1 beat = 26 frames
CONST SECT = 835
CONST BEAT = 26

frame = 0
section = 0
done = 0

MPLAY intro_s

DO
  ' ---- Section transitions ----
  ' 0: Intro       1 x 32 beats
  ' 1: Verse       2 x 32 beats (loop)
  ' 2: Chorus      2 x 32 beats (loop)
  ' 3: Bridge      1 x 32 beats
  ' 4: Chorus      2 x 32 beats (loop)
  ' 5: Fade out    ~3 sec
  ' 6: Done

  IF section = 0 THEN
    IF frame >= SECT THEN
      section = 1
      MPLAY verse_s
    END IF
  ELSEIF section = 1 THEN
    IF frame >= SECT * 3 THEN
      section = 2
      MPLAY chorus_s
    END IF
  ELSEIF section = 2 THEN
    IF frame >= SECT * 5 THEN
      section = 3
      MPLAY bridge_s
    END IF
  ELSEIF section = 3 THEN
    IF frame >= SECT * 6 THEN
      section = 4
      MPLAY chorus_s
    END IF
  ELSEIF section = 4 THEN
    IF frame >= SECT * 8 THEN
      section = 5
    END IF
  ELSEIF section = 5 THEN
    ' Fade master volume over 3 seconds (180 frames)
    fade_frame = frame - SECT * 8
    IF fade_frame >= 180 THEN
      section = 6
      MSTOP
      VOLUME 0
      done = 1
    ELSE
      vol = 176 - (fade_frame * 176 DIV 180)
      VOLUME vol
    END IF
  END IF

  ' ---- Display ----
  CLEAR

  TEXT_SM "DIGITAL HORIZON", 16, 2

  ' Section name
  IF section = 0 THEN
    TEXT_LG "INTRO", 34, 16
  ELSEIF section = 1 THEN
    TEXT_LG "VERSE", 34, 16
  ELSEIF section = 2 THEN
    TEXT_LG "CHORUS", 28, 16
  ELSEIF section = 3 THEN
    TEXT_LG "BRIDGE", 28, 16
  ELSEIF section = 4 THEN
    TEXT_LG "CHORUS", 28, 16
  ELSE
    TEXT_LG "FIN", 46, 16
  END IF

  ' Beat indicator bars - synced to 138 BPM
  pulse = frame MOD BEAT
  IF pulse < 3 THEN
    bh = 14
  ELSEIF pulse < 7 THEN
    bh = 10
  ELSE
    bh = 5
  END IF

  yb = 58
  RECT 14, yb - bh, 6, bh
  RECT 28, yb - bh, 6, bh
  RECT 42, yb - bh, 6, bh
  RECT 56, yb - bh, 6, bh
  RECT 70, yb - bh, 6, bh
  RECT 84, yb - bh, 6, bh
  RECT 98, yb - bh, 6, bh
  RECT 112, yb - bh, 6, bh

  ' Progress bar
  secs = frame DIV 60
  IF secs > 120 THEN
    secs = 120
  END IF
  RECT 4, 36, secs, 2

  ' Time display
  mins = secs DIV 60
  rem_s = secs MOD 60
  TEXT_NUM mins, 48, 42
  TEXT_SM ":", 54, 42
  IF rem_s < 10 THEN
    TEXT_SM "0", 58, 42
    TEXT_NUM rem_s, 62, 42
  ELSE
    TEXT_NUM rem_s, 58, 42
  END IF

  IF done = 0 THEN
    frame = frame + 1
  END IF

  YIELD
LOOP
