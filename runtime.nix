{
  pkgs ? import <nixpkgs> { },
  includeClangd ? false,
  includeGcc ? false,
  includeJava ? false,
  includeJdtls ? false,
  includeAria2 ? false,
}:

pkgs.buildEnv {
  name = "hydro-batter-code-edit-runtime";
  paths =
    pkgs.lib.optionals includeClangd [ pkgs.clang-tools ]
    ++ pkgs.lib.optionals includeGcc [ pkgs.gcc ]
    ++ pkgs.lib.optionals includeJava [ pkgs.jdk21 ]
    ++ pkgs.lib.optionals includeJdtls [ pkgs.jdt-language-server ]
    ++ pkgs.lib.optionals includeAria2 [ pkgs.aria2 ];
  ignoreCollisions = true;
}
