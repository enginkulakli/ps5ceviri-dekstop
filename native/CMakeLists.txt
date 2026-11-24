cmake_minimum_required(VERSION 3.22)
project(ps5_desktop_remote LANGUAGES C CXX)

set(CHIAKI_SOURCE "" CACHE PATH "Pinned chiaki-ng source checkout")
if(NOT EXISTS "${CHIAKI_SOURCE}/third-party/nanopb/CMakeLists.txt")
    message(FATAL_ERROR "Run scripts/checkout-chiaki.sh before configuring.")
endif()

foreach(feature TESTS CLI GUI ANDROID BOREALIS SETSU STEAMDECK_NATIVE SPEEX
        FFMPEG_DECODER PI_DECODER STEAM_SHORTCUT)
    set(CHIAKI_ENABLE_${feature} OFF CACHE STRING "" FORCE)
endforeach()
set(CHIAKI_LIB_ENABLE_OPUS OFF CACHE BOOL "" FORCE)
set(CHIAKI_USE_SYSTEM_JERASURE OFF CACHE STRING "" FORCE)
set(CHIAKI_USE_SYSTEM_NANOPB OFF CACHE STRING "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

find_package(OpenSSL REQUIRED)
add_subdirectory("${CHIAKI_SOURCE}" chiaki EXCLUDE_FROM_ALL)

add_executable(ps5-remote remote.c)
target_compile_features(ps5-remote PRIVATE c_std_11)
target_link_libraries(ps5-remote PRIVATE chiaki-lib OpenSSL::Crypto)
install(TARGETS ps5-remote RUNTIME DESTINATION .)
