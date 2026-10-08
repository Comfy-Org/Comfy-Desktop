"""A stand-in ComfyUI holding the database lock on argv[1] and writing its holder record as the
record contract says, then printing its pid. Run it as main.py where the record should place it.

Linux start token: boot id and /proc start ticks. The database path is recorded as ComfyUI does,
with os.path.abspath: resolved only as far as the path it was given (its default base directory
is a real path; an explicit --user-directory or --database-url is not). argv[2] == 'child' also starts a child,
in the holder's own process group, that does not have the file open; 'exit' exits at once.
"""
import fcntl, json, os, subprocess, sys, time

lock = sys.argv[1]
fd = os.open(lock, os.O_RDWR | os.O_CREAT)
fcntl.flock(fd, fcntl.LOCK_EX)
boot = open('/proc/sys/kernel/random/boot_id').read().strip()
stat = open('/proc/self/stat').read()
ticks = stat[stat.rindex(')') + 2:].split()[19]
record = {'version': 1, 'pid': os.getpid(), 'started': boot + ':' + ticks,
          'db': os.path.abspath(lock[:-len('.lock')]),
          'main': os.path.abspath(sys.argv[0]), 'argv': sys.argv}
tmp = lock + '.json.' + str(os.getpid()) + '.tmp'
with open(tmp, 'w') as f:
    json.dump(record, f)
os.replace(tmp, lock + '.json')
child = subprocess.Popen(['sleep', '600']).pid if sys.argv[2:] == ['child'] else 0
print(os.getpid(), child, flush=True)
if sys.argv[2:] == ['exit']:
    sys.exit(0)
time.sleep(600)
