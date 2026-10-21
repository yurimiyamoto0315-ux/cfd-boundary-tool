"""Python 3.11+ entry point; dependencies can be installed beside this file."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'.python-deps'))
from pipeline.server import main
if __name__=='__main__':
    main()
