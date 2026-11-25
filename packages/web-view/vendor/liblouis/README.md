# liblouis (WebAssembly)

`liblouis.js` is [liblouis](https://liblouis.io) 3.38.0, the open-source braille translator, built
to WebAssembly in one file with the tables listed in `tables.txt` inside it. Reader uses it to show
eBraille books as print text (`../../src/braille.ts`): it translates their braille cells back to
print ("back-translation").

liblouis is under the GNU Lesser General Public License 2.1 or later (`COPYING.LESSER`). Its source
is at https://github.com/liblouis/liblouis (tag v3.38.0); Reader uses it unchanged.

## Tables

UEB grade 1 and 2 and US English braille (`en-ueb-*`, `en-us-*`), the Indian-language Bharati braille
tables (`*-in-g1.utb`, `ta-ta-g1.ctb`), `unicode.dis` (Unicode braille cells) and the files they
include: 45 files, about 490 KB.

## Rebuilding

With the [Emscripten SDK](https://emscripten.org) installed (`emsdk install latest`, `emsdk activate latest`):

1. `git clone --depth 1 --branch v3.38.0 https://github.com/liblouis/liblouis.git`
2. In a new folder: copy `config.h` from here, make `liblouis.h` from `liblouis/liblouis/liblouis.h.in`
   with `@WIDECHAR_TYPE@` replaced by `unsigned short int` (UTF-16, as JavaScript strings), and
   copy the tables in `tables.txt` from `liblouis/tables` into `tables/`.
3. Compile:

```sh
emcc ../liblouis/liblouis/{commonTranslationFunctions,compileTranslationTable,logging,lou_backTranslateString,lou_translateString,metadata,pattern,utils}.c \
  -I. -I../liblouis/liblouis -O2 -DTABLESDIR=\"/tables\" \
  -sMODULARIZE=1 -sEXPORT_NAME=createLouis -sSINGLE_FILE=1 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node \
  -sEXPORTED_FUNCTIONS=_lou_backTranslateString,_lou_translateString,_lou_version,_lou_free,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=cwrap,ccall,UTF8ToString,HEAPU16,HEAP32,stringToUTF8,lengthBytesUTF8 \
  --embed-file tables@/tables -o liblouis.js
```

The page loading it needs `'wasm-unsafe-eval'` in its Content-Security-Policy `script-src`.
