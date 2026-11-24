// SPDX-License-Identifier: AGPL-3.0-only
// Desktop transport for the registration and 720p H.264 session in Android V3 remote_play.c.
#include <stdio.h>
#include <string.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#else
#include <signal.h>
#endif
#include <chiaki/regist.h>
#include <chiaki/session.h>
#include <openssl/crypto.h>

typedef struct {
    bool success;
    uint8_t bytes[38];  /* MAC address, registration key and session key */
} RegistrationResult;

typedef struct {
    ChiakiSession session;
    ChiakiLog log;
    ChiakiMutex lock;
    bool active;
    bool rejected;
} RemoteSession;

static int fail(const char *message)
{
    fprintf(stderr, "error:%s\n", message);
    return 1;
}

static void registration_event(ChiakiRegistEvent *event, void *user)
{
    RegistrationResult *result = user;
    if (event->type != CHIAKI_REGIST_EVENT_TYPE_FINISHED_SUCCESS) return;
    memcpy(result->bytes, event->registered_host->server_mac, 6);
    memcpy(result->bytes + 6, event->registered_host->rp_regist_key, 16);
    memcpy(result->bytes + 22, event->registered_host->rp_key, 16);
    result->success = true;
}

static int register_console(const char *host)
{
    uint8_t input[12] = {0};
    if (fread(input, 1, sizeof(input), stdin) != sizeof(input)) {
        OPENSSL_cleanse(input, sizeof(input));
        return fail("invalid registration input");
    }
    ChiakiRegistInfo info = { .target = CHIAKI_TARGET_PS5_1, .host = host };
    memcpy(info.psn_account_id, input, CHIAKI_PSN_ACCOUNT_ID_SIZE);
    info.pin = (uint32_t)input[8] | (uint32_t)input[9] << 8 |
               (uint32_t)input[10] << 16 | (uint32_t)input[11] << 24;
    OPENSSL_cleanse(input, sizeof(input));
    if (info.pin > 99999999) {
        OPENSSL_cleanse(&info, sizeof(info));
        return fail("invalid PIN");
    }

    ChiakiLog log;
    chiaki_log_init(&log, 0, NULL, NULL);
    ChiakiRegist registration;
    RegistrationResult result = {0};
    ChiakiErrorCode error = chiaki_regist_start(&registration, &log, &info, registration_event, &result);
    OPENSSL_cleanse(&info, sizeof(info));
    if (error != CHIAKI_ERR_SUCCESS) return fail(chiaki_error_string(error));
    chiaki_regist_fini(&registration);
    OPENSSL_cleanse(&registration, sizeof(registration));

    bool registered = result.success && memcmp(result.bytes, (uint8_t[6]){0}, 6) != 0;
    bool written = registered &&
        fwrite(result.bytes, 1, sizeof(result.bytes), stdout) == sizeof(result.bytes) && fflush(stdout) == 0;
    OPENSSL_cleanse(&result, sizeof(result));
    return written ? 0 : fail("PS5 rejected registration or did not provide a console identity");
}

static bool video_sample(uint8_t *data, size_t size, int32_t lost, bool recovered, void *user)
{
    (void)lost;
    (void)recovered;
    (void)user;
    return fwrite(data, 1, size, stdout) == size && fflush(stdout) == 0;
}

static void session_event(ChiakiEvent *event, void *user)
{
    RemoteSession *remote = user;
    switch (event->type) {
        case CHIAKI_EVENT_CONNECTED:
            fputs("connected\n", stderr);
            break;
        case CHIAKI_EVENT_LOGIN_PIN_REQUEST:
            fputs(event->login_pin_request.pin_incorrect ? "login-pin-incorrect\n" : "login-pin-required\n", stderr);
            break;
        case CHIAKI_EVENT_QUIT:
            remote->rejected = chiaki_quit_reason_is_error(event->quit.reason);
            fprintf(stderr, "quit:%s\n", chiaki_quit_reason_string(event->quit.reason));
            break;
        default:
            break;
    }
}

static void *read_stop(void *user)
{
    RemoteSession *remote = user;
    char line[8];
    while (fgets(line, sizeof(line), stdin)) {
        chiaki_mutex_lock(&remote->lock);
        if (remote->active && strlen(line) == 5 && line[4] == '\n' && strspn(line, "0123456789") == 4)
            chiaki_session_set_login_pin(&remote->session, (const uint8_t *)line, 4);
        chiaki_mutex_unlock(&remote->lock);
        OPENSSL_cleanse(line, sizeof(line));
    }
    /* Electron closes its pipe on Stop and when the parent process exits. */
    chiaki_mutex_lock(&remote->lock);
    if (remote->active) chiaki_session_stop(&remote->session);
    chiaki_mutex_unlock(&remote->lock);
    return NULL;
}

static int stream(const char *host)
{
    static RemoteSession remote;
    uint8_t material[32] = {0};
    if (fread(material, 1, sizeof(material), stdin) != sizeof(material)) {
        OPENSSL_cleanse(material, sizeof(material));
        return fail("invalid session input");
    }
    ChiakiConnectInfo info = { .host = host, .ps5 = true,
        .audio_video_disabled = CHIAKI_AUDIO_DISABLED,
        .enable_idr_on_fec_failure = true, .packet_loss_max = 0.1 };
    memcpy(info.regist_key, material, sizeof(info.regist_key));
    memcpy(info.morning, material + 16, sizeof(info.morning));
    OPENSSL_cleanse(material, sizeof(material));
    chiaki_connect_video_profile_preset(&info.video_profile, CHIAKI_VIDEO_RESOLUTION_PRESET_720p,
                                       CHIAKI_VIDEO_FPS_PRESET_30);
    info.video_profile.codec = CHIAKI_CODEC_H264;
    chiaki_log_init(&remote.log, 0, NULL, NULL);
    ChiakiErrorCode error = chiaki_mutex_init(&remote.lock, false);
    if (error == CHIAKI_ERR_SUCCESS) error = chiaki_session_init(&remote.session, &info, &remote.log);
    OPENSSL_cleanse(&info, sizeof(info));
    if (error != CHIAKI_ERR_SUCCESS) return fail(chiaki_error_string(error));

    chiaki_session_set_video_sample_cb(&remote.session, video_sample, &remote);
    chiaki_session_set_event_cb(&remote.session, session_event, &remote);
    error = chiaki_session_start(&remote.session);
    if (error != CHIAKI_ERR_SUCCESS) {
        chiaki_session_fini(&remote.session);
        return fail(chiaki_error_string(error));
    }
    remote.active = true;
    ChiakiThread control;
    error = chiaki_thread_create(&control, read_stop, &remote);
    if (error != CHIAKI_ERR_SUCCESS) chiaki_session_stop(&remote.session);
    chiaki_session_join(&remote.session);
    chiaki_mutex_lock(&remote.lock);
    remote.active = false;
    chiaki_mutex_unlock(&remote.lock);
    chiaki_session_fini(&remote.session);
    return remote.rejected || error != CHIAKI_ERR_SUCCESS ? 1 : 0;
}

int main(int argc, char **argv)
{
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#else
    signal(SIGPIPE, SIG_IGN);
#endif
    if (chiaki_lib_init() != CHIAKI_ERR_SUCCESS) return fail("Chiaki could not start");
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        puts("ps5-remote chiaki PS5 H264");
        return 0;
    }
    if (argc == 3 && strcmp(argv[1], "pair") == 0) return register_console(argv[2]);
    if (argc == 3 && strcmp(argv[1], "stream") == 0) return stream(argv[2]);
    return fail("invalid command");
}
