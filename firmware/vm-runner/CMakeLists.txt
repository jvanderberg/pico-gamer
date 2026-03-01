cmake_minimum_required(VERSION 3.13)

include(pico_sdk_import.cmake)

project(vm_runner C CXX ASM)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

pico_sdk_init()

add_executable(vm_runner
    main.cpp
    ../../vm/lib/pico_vm/vm.cpp
    ../../vm/lib/pico_vm/display.cpp
    ../../vm/lib/pico_vm/font.cpp
    ../../vm/lib/pico_vm/sprites.cpp
    ../../vm/lib/pico_vm/syscalls.cpp
    ../../vm/lib/pico_vm/runtime.cpp
)

target_include_directories(vm_runner PRIVATE
    ../../vm/lib/pico_vm
)

target_link_libraries(vm_runner
    pico_stdlib
    hardware_i2c
    hardware_dma
    hardware_adc
)

pico_enable_stdio_usb(vm_runner 1)
pico_enable_stdio_uart(vm_runner 0)

pico_add_extra_outputs(vm_runner)
