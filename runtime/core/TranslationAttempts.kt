package expo.modules.ps5translator.core

/** The pipeline owns the slots. The transport may register a release action on its I/O thread. */
internal class TranslationAttempt {
  @Volatile var cancelled = false
    private set
  private var abort: (() -> Unit)? = null
  var canRelease = true

  fun attach(action: () -> Unit) {
    val alreadyCancelled = synchronized(this) {
      if (cancelled) true else { abort = action; false }
    }
    if (alreadyCancelled) action()
  }

  @Synchronized
  fun detach() { abort = null }

  fun cancel() {
    val action = synchronized(this) {
      cancelled = true
      abort.also { abort = null }
    }
    action?.invoke()
  }
}

internal class TranslationAttempts {
  private val running = LinkedHashMap<String, TranslationAttempt>()
  val room get() = 2 - running.size
  val busy get() = running.isNotEmpty()

  operator fun contains(key: String) = key in running

  fun releaseObsolete(visible: Set<String>, needed: Int) {
    val obsolete = running.entries.filter { (key, work) -> key !in visible && work.canRelease }
    for ((key, work) in obsolete.take((needed - room).coerceAtLeast(0))) {
      running.remove(key)
      work.cancel()
    }
  }

  fun start(key: String): TranslationAttempt = TranslationAttempt().also { running[key] = it }

  fun current(key: String, attempt: TranslationAttempt) = running[key] === attempt

  fun finish(key: String, attempt: TranslationAttempt) {
    if (current(key, attempt)) running.remove(key)
  }

  fun clear() {
    running.values.forEach(TranslationAttempt::cancel)
    running.clear()
  }
}
