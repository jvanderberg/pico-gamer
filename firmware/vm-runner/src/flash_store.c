// Flash partition abstraction for game storage
//
// Read:  XIP memcpy from 0x10040000 + offset
// Write: 4KB write cache — accumulates sectors, flushes (erase+program)
//        when the erase block changes or on explicit flush.

#include "flash_store.h"
#include "fat12_format.h"

#include <string.h>
#include "pico/stdlib.h"
#include "hardware/flash.h"
#include "hardware/sync.h"

// XIP base address of the game partition
#define XIP_PARTITION_BASE (XIP_BASE + FLASH_PARTITION_OFFSET)

// 4KB write cache
static uint8_t  write_cache[FLASH_ERASE_SIZE];
static int32_t  cached_block = -1;  // which 4KB block is loaded (-1 = none)
static bool     cache_dirty = false;

// Flush the write cache to flash (erase + program)
static void flush_cache(void) {
    if (!cache_dirty || cached_block < 0) return;

    uint32_t flash_offset = FLASH_PARTITION_OFFSET + (uint32_t)cached_block * FLASH_ERASE_SIZE;

    uint32_t ints = save_and_disable_interrupts();
    flash_range_erase(flash_offset, FLASH_ERASE_SIZE);
    flash_range_program(flash_offset, write_cache, FLASH_ERASE_SIZE);
    restore_interrupts(ints);

    // Invalidate XIP cache so subsequent reads see fresh data
    flash_flush_cache();

    cache_dirty = false;
}

void flash_store_init(void) {
    cached_block = -1;
    cache_dirty = false;
}

void flash_store_read(uint32_t sector, uint8_t *buf, uint32_t count) {
    // If reading from a cached (dirty) block, serve from cache
    for (uint32_t i = 0; i < count; i++) {
        uint32_t s = sector + i;
        int32_t block = (int32_t)(s / FLASH_SECTORS_PER_BLOCK);
        uint32_t offset_in_block = (s % FLASH_SECTORS_PER_BLOCK) * FLASH_SECTOR_SIZE;

        if (block == cached_block && cache_dirty) {
            memcpy(buf + i * FLASH_SECTOR_SIZE,
                   write_cache + offset_in_block,
                   FLASH_SECTOR_SIZE);
        } else {
            const uint8_t *src = (const uint8_t *)(XIP_PARTITION_BASE
                                  + s * FLASH_SECTOR_SIZE);
            memcpy(buf + i * FLASH_SECTOR_SIZE, src, FLASH_SECTOR_SIZE);
        }
    }
}

void flash_store_write(uint32_t sector, const uint8_t *buf, uint32_t count) {
    for (uint32_t i = 0; i < count; i++) {
        uint32_t s = sector + i;
        int32_t block = (int32_t)(s / FLASH_SECTORS_PER_BLOCK);
        uint32_t offset_in_block = (s % FLASH_SECTORS_PER_BLOCK) * FLASH_SECTOR_SIZE;

        // If we're writing to a different block, flush the old one
        if (block != cached_block) {
            flush_cache();

            // Load the new block from flash into cache
            const uint8_t *src = (const uint8_t *)(XIP_PARTITION_BASE
                                  + (uint32_t)block * FLASH_ERASE_SIZE);
            memcpy(write_cache, src, FLASH_ERASE_SIZE);
            cached_block = block;
        }

        // Write sector data into cache
        memcpy(write_cache + offset_in_block,
               buf + i * FLASH_SECTOR_SIZE,
               FLASH_SECTOR_SIZE);
        cache_dirty = true;
    }
}

void flash_store_flush(void) {
    flush_cache();
}

bool flash_store_has_filesystem(void) {
    const uint8_t *boot = (const uint8_t *)XIP_PARTITION_BASE;
    // Check for boot sector signature 0x55AA at offset 510
    return (boot[510] == 0x55 && boot[511] == 0xAA);
}

void flash_store_format(void) {
    // Copy blank image to RAM first — can't read from flash during programming
    // (FAT12_BLANK_IMAGE is static const → lives in XIP flash, which is
    // disabled while flash_range_erase/program run)
    memcpy(write_cache, FAT12_BLANK_IMAGE, FAT12_BLANK_IMAGE_SIZE);

    uint32_t ints = save_and_disable_interrupts();
    flash_range_erase(FLASH_PARTITION_OFFSET, FLASH_ERASE_SIZE);
    flash_range_program(FLASH_PARTITION_OFFSET, write_cache, FAT12_BLANK_IMAGE_SIZE);
    restore_interrupts(ints);

    // Invalidate cache since we wrote directly
    cached_block = -1;
    cache_dirty = false;
}
