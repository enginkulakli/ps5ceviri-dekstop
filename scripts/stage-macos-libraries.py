"""Copy the Chiaki helper's dynamic library closure and use bundle-relative load paths."""

from pathlib import Path
import re
import shutil
import subprocess
import sys


def run(*args):
    return subprocess.check_output([str(arg) for arg in args], text=True)


def dependencies(binary):
    return [
        line.strip().split(" (compatibility version", 1)[0]
        for line in run("otool", "-arch", "arm64", "-L", binary).splitlines()[1:]
        if line.startswith("\t")
    ]


def rpaths(binary):
    commands = run("otool", "-arch", "arm64", "-l", binary)
    return re.findall(r"cmd LC_RPATH\s+cmdsize \d+\s+path (.+) \(offset \d+\)", commands)


def system_library(name):
    return name.startswith(("/usr/lib/", "/System/Library/"))


def resolve(name, source, executable, search):
    if name.startswith("@loader_path/"):
        candidates = [source.parent / name.removeprefix("@loader_path/")]
    elif name.startswith("@executable_path/"):
        candidates = [executable.parent / name.removeprefix("@executable_path/")]
    elif name.startswith("@rpath/"):
        relative = name.removeprefix("@rpath/")
        directories = [
            Path(item.replace("@loader_path", str(source.parent))
                 .replace("@executable_path", str(executable.parent)))
            for item in (*rpaths(source), *rpaths(executable))
        ]
        candidates = [directory / relative for directory in (*directories, *search)]
    else:
        candidates = [Path(name)]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError(f"Cannot resolve {name} loaded by {source}")


def stage(binary, search):
    destination = binary.parent / "lib"
    destination.mkdir(exist_ok=True)
    copied = {}
    pending = [(binary, binary)]
    while pending:
        source, output = pending.pop()
        names = dependencies(source)
        dylib = output != binary
        if dylib:
            names = names[1:]
        edits = ["install_name_tool"]
        if dylib:
            edits += ["-id", "@rpath/" + output.name]
        for name in names:
            if system_library(name):
                continue
            library = resolve(name, source, binary, search)
            filename = Path(name).name
            target = destination / filename
            previous = copied.get(filename)
            if previous is not None and previous != library:
                raise RuntimeError(f"Conflicting libraries for {filename}: {previous}, {library}")
            if previous is None:
                copied[filename] = library
                shutil.copyfile(library, target)
                target.chmod(0o755)
                pending.append((library, target))
            relative = filename if dylib else "lib/" + filename
            edits += ["-change", name, "@loader_path/" + relative]
        for rpath in dict.fromkeys(rpaths(source)):
            edits += ["-delete_rpath", rpath]
        if len(edits) > 1:
            subprocess.check_call([*edits, str(output)])

    for output in [*(destination / name for name in sorted(copied)), binary]:
        subprocess.check_call(["lipo", "-verify_arch", "arm64", str(output)])
        subprocess.check_call(["codesign", "--force", "--sign", "-", str(output)])


if __name__ == "__main__":
    stage(Path(sys.argv[1]).resolve(), [Path(prefix) / "lib" for prefix in sys.argv[2:]])
