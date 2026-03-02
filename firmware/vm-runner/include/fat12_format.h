#pragma once
// Blank FAT12 filesystem image — 4096 bytes (one flash erase block)
//
// Geometry:
//   Total sectors:      3584 (512 bytes each)
//   Sectors/cluster:    8 (4KB — matches flash erase granularity)
//   Reserved sectors:   2
//   FAT copies:         2, 2 sectors each (4 sectors total)
//   Root dir entries:   64 (2 sectors)
//   Data area start:    sector 8 (4KB-aligned)
//   Data clusters:      447
//
// Layout (all within this 4KB image):
//   Sector 0:     Boot sector (BPB) with volume label
//   Sector 1:     Reserved (zero-filled)
//   Sectors 2-3:  FAT1 (cluster 0 = 0xFF8 media, cluster 1 = 0xFFF)
//   Sectors 4-5:  FAT2 (copy of FAT1)
//   Sectors 6-7:  Root directory (volume label entry + empty)

#include <stdint.h>

#define FAT12_BLANK_IMAGE_SIZE 4096

// clang-format off
static const uint8_t FAT12_BLANK_IMAGE[FAT12_BLANK_IMAGE_SIZE] = {
    // === Sector 0: Boot sector / BPB (512 bytes) ===
    0xEB, 0x3C, 0x90,                          // Jump boot code
    'M', 'S', 'D', 'O', 'S', '5', '.', '0',   // OEM name
    0x00, 0x02,                                 // Bytes per sector: 512
    0x08,                                       // Sectors per cluster: 8
    0x02, 0x00,                                 // Reserved sectors: 2
    0x02,                                       // Number of FATs: 2
    0x40, 0x00,                                 // Root dir entries: 64
    0x00, 0x0E,                                 // Total sectors: 3584 (0x0E00)
    0xF8,                                       // Media type: fixed disk
    0x02, 0x00,                                 // Sectors per FAT: 2
    0x01, 0x00,                                 // Sectors per track: 1
    0x01, 0x00,                                 // Number of heads: 1
    0x00, 0x00, 0x00, 0x00,                     // Hidden sectors: 0
    0x00, 0x00, 0x00, 0x00,                     // Total sectors (32-bit): 0 (using 16-bit field)
    0x80,                                       // Drive number: 0x80
    0x00,                                       // Reserved
    0x29,                                       // Extended boot signature
    0x47, 0x41, 0x4D, 0x45,                     // Volume serial: "GAME"
    'P', 'I', 'C', 'O', ' ', 'G', 'A', 'M', 'E', 'R', ' ',  // Volume label (11 bytes)
    'F', 'A', 'T', '1', '2', ' ', ' ', ' ',    // FS type: "FAT12   "

    // Boot code area (448 bytes, zero-filled)
    [62] = 0,  // Start of boot code (implicitly zero to 509)

    // Boot signature at offset 510-511
    [510] = 0x55, [511] = 0xAA,

    // === Sector 1: Reserved (512 bytes, all zeros) ===
    // [512..1023] implicitly zero

    // === Sector 2: FAT1, first sector (512 bytes) ===
    // Cluster 0: media byte 0xF8 → entry = 0xFF8
    // Cluster 1: end-of-chain marker = 0xFFF
    // FAT12 packs 2 entries per 3 bytes:
    //   entry0 = 0xFF8, entry1 = 0xFFF
    //   byte0 = 0xF8, byte1 = 0xFF, byte2 = 0xFF
    [1024] = 0xF8, [1025] = 0xFF, [1026] = 0xFF,
    // Remaining entries are 0x000 (free) — implicitly zero

    // === Sector 3: FAT1, second sector (512 bytes, all zeros) ===
    // [1536..2047] implicitly zero

    // === Sector 4: FAT2, first sector (copy of FAT1) ===
    [2048] = 0xF8, [2049] = 0xFF, [2050] = 0xFF,
    // [2051..2559] implicitly zero

    // === Sector 5: FAT2, second sector (512 bytes, all zeros) ===
    // [2560..3071] implicitly zero

    // === Sector 6: Root directory, first sector (512 bytes) ===
    // Volume label entry (32 bytes)
    [3072] = 'P', [3073] = 'I', [3074] = 'C', [3075] = 'O',
    [3076] = ' ', [3077] = 'G', [3078] = 'A', [3079] = 'M',
    [3080] = 'E', [3081] = 'R', [3082] = ' ',
    [3083] = 0x08,  // Attribute: volume label
    // Remaining 20 bytes of this entry are zero (timestamps etc.)
    // Remaining 15 dir entries in this sector are zero (empty)

    // === Sector 7: Root directory, second sector (512 bytes, all zeros) ===
    // [3584..4095] implicitly zero — 16 more empty dir entries
};
// clang-format on
