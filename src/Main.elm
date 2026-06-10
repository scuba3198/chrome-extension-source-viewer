port module Main exposing (main)

import Browser
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Json.Decode as D
import Json.Encode as E



-- Ports definitions


port requestZipContents : String -> Cmd msg


port requestFileContent : { path : String, beautify : Bool } -> Cmd msg


port requestHighlight : { path : String, content : String } -> Cmd msg


port saveSetting : { key : String, value : String } -> Cmd msg


port zipLoaded : (D.Value -> msg) -> Sub msg


port zipLoadError : (String -> msg) -> Sub msg


port fileContentReceived : (D.Value -> msg) -> Sub msg


port highlightedReceived : (D.Value -> msg) -> Sub msg


port settingsLoaded : (D.Value -> msg) -> Sub msg


type alias ZipEntry =
    { path : String
    , size : Int
    , isDirectory : Bool
    }


type alias FilterOptions =
    { code : Bool
    , markup : Bool
    , images : Bool
    , locales : Bool
    , misc : Bool
    , fileSearch : String
    }


type alias Model =
    { files : List ZipEntry
    , selectedFile : Maybe String
    , selectedFileContent : Maybe String
    , selectedFileHtml : Maybe String
    , isBeautified : Bool
    , showAnalysis : Bool
    , filterOptions : FilterOptions
    , isLoading : Bool
    , errorMessage : Maybe String
    , webstoreUrl : Maybe String
    , downloadUrl : Maybe String
    , downloadName : String
    , crxDownloadUrl : Maybe String
    , crxDownloadName : Maybe String
    , openViewerUrl : Maybe String
    }


type FilterType
    = Code
    | Markup
    | Images
    | Locales
    | Misc


type Msg
    = ToggleFilter FilterType
    | SearchInput String
    | SelectFile String
    | ToggleBeautify
    | ToggleAnalysis
    | RequestZip String
    | HandleZipLoaded D.Value
    | HandleZipError String
    | HandleFileContent D.Value
    | HandleHighlighted D.Value
    | HandleSettings D.Value


init : D.Value -> ( Model, Cmd Msg )
init _ =
    ( { files = []
      , selectedFile = Nothing
      , selectedFileContent = Nothing
      , selectedFileHtml = Nothing
      , isBeautified = False
      , showAnalysis = False
      , filterOptions =
            { code = False
            , markup = False
            , images = False
            , locales = False
            , misc = False
            , fileSearch = ""
            }
      , isLoading = True
      , errorMessage = Nothing
      , webstoreUrl = Nothing
      , downloadUrl = Nothing
      , downloadName = "extension.zip"
      , crxDownloadUrl = Nothing
      , crxDownloadName = Nothing
      , openViewerUrl = Nothing
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        ToggleFilter ftype ->
            let
                old =
                    model.filterOptions

                newFilters =
                    case ftype of
                        Code ->
                            { old | code = not old.code }

                        Markup ->
                            { old | markup = not old.markup }

                        Images ->
                            { old | images = not old.images }

                        Locales ->
                            { old | locales = not old.locales }

                        Misc ->
                            { old | misc = not old.misc }
            in
            ( { model | filterOptions = newFilters }, Cmd.none )

        SearchInput text ->
            let
                old =
                    model.filterOptions

                newFilters =
                    { old | fileSearch = text }
            in
            ( { model | filterOptions = newFilters }, Cmd.none )

        SelectFile path ->
            ( { model | selectedFile = Just path, selectedFileContent = Nothing, selectedFileHtml = Nothing, isLoading = True }
            , requestFileContent { path = path, beautify = model.isBeautified }
            )

        ToggleBeautify ->
            let
                newBeautify =
                    not model.isBeautified
            in
            case model.selectedFile of
                Just path ->
                    ( { model | isBeautified = newBeautify, isLoading = True }
                    , requestFileContent { path = path, beautify = newBeautify }
                    )

                Nothing ->
                    ( { model | isBeautified = newBeautify }, Cmd.none )

        ToggleAnalysis ->
            ( { model | showAnalysis = not model.showAnalysis }, Cmd.none )

        RequestZip url ->
            ( { model | isLoading = True, errorMessage = Nothing }, requestZipContents url )

        HandleZipLoaded val ->
            case D.decodeValue metadataDecoder val of
                Ok meta ->
                    ( { model
                        | files = meta.entries
                        , webstoreUrl = meta.webstoreUrl
                        , downloadUrl = meta.downloadUrl
                        , downloadName = meta.zipname
                        , crxDownloadUrl = meta.crxDownloadUrl
                        , crxDownloadName = meta.crxDownloadName
                        , openViewerUrl = meta.openViewerUrl
                        , isLoading = False
                      }
                    , Cmd.none
                    )

                Err err ->
                    ( { model | errorMessage = Just ("Failed to parse zip metadata: " ++ D.errorToString err), isLoading = False }, Cmd.none )

        HandleZipError err ->
            ( { model | errorMessage = Just err, isLoading = False }, Cmd.none )

        HandleFileContent val ->
            let
                decoder =
                    D.map2 Tuple.pair (D.field "content" D.string) (D.field "isBeautified" D.bool)
            in
            case D.decodeValue decoder val of
                Ok ( content, _ ) ->
                    case model.selectedFile of
                        Just path ->
                            ( { model | selectedFileContent = Just content }
                            , requestHighlight { path = path, content = content }
                            )

                        Nothing ->
                            ( model, Cmd.none )

                Err _ ->
                    ( { model | errorMessage = Just "Failed to read file contents", isLoading = False }, Cmd.none )

        HandleHighlighted val ->
            let
                decoder =
                    D.field "htmlContent" D.string
            in
            case D.decodeValue decoder val of
                Ok html ->
                    ( { model | selectedFileHtml = Just html, isLoading = False }, Cmd.none )

                Err _ ->
                    ( { model | errorMessage = Just "Failed to render syntax highlighting", isLoading = False }, Cmd.none )

        HandleSettings _ ->
            -- TODO: implement settings loading logic if needed
            ( model, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.batch
        [ zipLoaded HandleZipLoaded
        , zipLoadError HandleZipError
        , fileContentReceived HandleFileContent
        , highlightedReceived HandleHighlighted
        , settingsLoaded HandleSettings
        ]



-- Helper to match file types for filtering


getGenericType : String -> String
getGenericType filename =
    if filename == "manifest.json" then
        ""

    else
        let
            ext =
                String.toLower (Maybe.withDefault "" (List.head (List.reverse (String.split "." filename))))
        in
        if List.member ext [ "js", "jsx", "ts", "tsx", "wat", "coffee", "jsm" ] then
            "code"

        else if List.member ext [ "bmp", "cur", "gif", "ico", "jpg", "jpeg", "png", "psd", "svg", "tiff", "xcf", "webp" ] then
            "images"

        else if List.member ext [ "css", "sass", "less", "html", "htm", "xhtml", "xml", "xbl", "xul" ] then
            "markup"

        else if String.startsWith "_locales/" filename || String.contains "locale/" filename then
            "locales"

        else
            "misc"



-- Filter entries based on checkboxes and search query


filterEntries : FilterOptions -> List ZipEntry -> List ZipEntry
filterEntries opts entries =
    let
        -- Filter by file path search query
        matchesSearch entry =
            if String.isEmpty opts.fileSearch then
                True

            else
                String.contains (String.toLower opts.fileSearch) (String.toLower entry.path)

        -- Filter by active checkbox categories
        matchesCategories entry =
            let
                gtype =
                    getGenericType entry.path

                anyActive =
                    opts.code || opts.markup || opts.images || opts.locales || opts.misc
            in
            if not anyActive then
                True

            else
                case gtype of
                    "code" ->
                        opts.code

                    "markup" ->
                        opts.markup

                    "images" ->
                        opts.images

                    "locales" ->
                        opts.locales

                    _ ->
                        opts.misc
    in
    List.filter (\e -> not e.isDirectory && matchesSearch e && matchesCategories e) entries


countFilterType : String -> List ZipEntry -> Int
countFilterType targetType entries =
    List.length (List.filter (\e -> not e.isDirectory && getGenericType e.path == targetType) entries)


formatByteSize : Int -> String
formatByteSize n =
    let
        str =
            String.fromInt n

        insertCommas s =
            if String.length s <= 3 then
                s

            else
                insertCommas (String.dropRight 3 s) ++ "," ++ String.right 3 s
    in
    insertCommas str


formatByteSizeSuffix : Int -> String
formatByteSizeSuffix fileSize =
    if fileSize < 10000 then
        String.fromInt fileSize ++ " B"

    else if fileSize < 1000000 then
        String.fromInt (round (toFloat fileSize / 1000)) ++ " KB"

    else if fileSize < 1000000000 then
        String.fromInt (round (toFloat fileSize / 1000000)) ++ " MB"

    else
        String.fromInt (round (toFloat fileSize / 1000000000)) ++ " GB"


view : Model -> Html Msg
view model =
    let
        filtered =
            filterEntries model.filterOptions model.files

        totalSize =
            List.sum (List.map .size filtered)

        fileItem entry =
            let
                isSelected =
                    Just entry.path == model.selectedFile

                baseName =
                    Maybe.withDefault entry.path (List.head (List.reverse (String.split "/" entry.path)))

                dirName =
                    String.dropRight (String.length baseName) entry.path
            in
            li
                [ classList [ ( "file-selected", isSelected ) ]
                , onClick (SelectFile entry.path)
                ]
                [ span [ class "file-path", title entry.path ]
                    [ span [ class "file-dir" ] [ text dirName ]
                    , span [ class "file-name" ] [ text baseName ]
                    ]
                , span [ class "file-size", title (formatByteSize entry.size ++ " bytes") ]
                    [ text (formatByteSizeSuffix entry.size) ]
                ]
    in
    div [ id "crxviewer-container" ]
        [ div [ id "top-bar" ]
            [ Html.form [ onSubmit (SearchInput model.filterOptions.fileSearch) ]
                [ input
                    [ id "file-filter"
                    , type_ "text"
                    , placeholder "filter (regex) ! file search"
                    , title "File filter (case-insensitive). Formats:\n1. [filename filter regexp]\n2. [filename filter regexp]!file content search term (case-insensitive)\n3. [filename filter regexp]!case:file content search term (case-sensitive)\n4. [filename filter regexp]!regexp:filter content regexp (case-sensitive)\n5. [filename filter regexp]!iregexp:filter content regexp (case-insensitive)\nThe filename filter is optional, '!search term' can also be used directly to search in all files."
                    , value model.filterOptions.fileSearch
                    , onInput SearchInput
                    , attribute "list" "file-filter-patterns"
                    ]
                    []
                , label [ title "Filter: Images" ]
                    [ input
                        [ type_ "checkbox"
                        , checked model.filterOptions.images
                        , onCheck (\_ -> ToggleFilter Images)
                        , attribute "data-filter-type" "images"
                        ]
                        []
                    , span [ class "filter-label-description" ] [ text "Images" ]
                    , span [ class "gcount" ] [ text (String.fromInt (countFilterType "images" model.files)) ]
                    ]
                , label [ title "Filter: JavaScript code" ]
                    [ input
                        [ type_ "checkbox"
                        , checked model.filterOptions.code
                        , onCheck (\_ -> ToggleFilter Code)
                        , attribute "data-filter-type" "code"
                        ]
                        []
                    , span [ class "filter-label-description" ] [ text "Code" ]
                    , span [ class "gcount" ] [ text (String.fromInt (countFilterType "code" model.files)) ]
                    ]
                , label [ title "Filter: HTML, CSS" ]
                    [ input
                        [ type_ "checkbox"
                        , checked model.filterOptions.markup
                        , onCheck (\_ -> ToggleFilter Markup)
                        , attribute "data-filter-type" "markup"
                        ]
                        []
                    , span [ class "filter-label-description" ] [ text "Markup" ]
                    , span [ class "gcount" ] [ text (String.fromInt (countFilterType "markup" model.files)) ]
                    ]
                , label [ title "Filter: Translations used by chrome.i18n" ]
                    [ input
                        [ type_ "checkbox"
                        , checked model.filterOptions.locales
                        , onCheck (\_ -> ToggleFilter Locales)
                        , attribute "data-filter-type" "locales"
                        ]
                        []
                    , span [ class "filter-label-description" ] [ text "Locales" ]
                    , span [ class "gcount" ] [ text (String.fromInt (countFilterType "locales" model.files)) ]
                    ]
                , label [ title "Filter: Other files" ]
                    [ input
                        [ type_ "checkbox"
                        , checked model.filterOptions.misc
                        , onCheck (\_ -> ToggleFilter Misc)
                        , attribute "data-filter-type" "misc"
                        ]
                        []
                    , span [ class "filter-label-description" ] [ text "Misc" ]
                    , span [ class "gcount" ] [ text (String.fromInt (countFilterType "misc" model.files)) ]
                    ]
                ]
            , span [ id "file-filter-feedback" ] []
            , case model.webstoreUrl of
                Just url ->
                    a [ id "webstore-link", href url, title url ] [ text "Listing" ]

                Nothing ->
                    text ""
            , case model.downloadUrl of
                Just url ->
                    a [ id "download-link", href url, download model.downloadName, title ("Download zip file as " ++ model.downloadName) ] [ text "Download" ]

                Nothing ->
                    text ""
            , case ( model.crxDownloadUrl, model.crxDownloadName ) of
                ( Just url, Just name ) ->
                    a [ id "download-link-crx", href url, download name, title ("Download original CRX file as " ++ name) ] [ text "CRX" ]

                _ ->
                    text ""
            , case model.openViewerUrl of
                Just url ->
                    a [ id "open-crxviewer", href url, title "View the source of another extension or zip file" ] [ text "Open" ]

                Nothing ->
                    text ""
            ]
        , div [ id "left-panel" ]
            [ div [ class "content" ]
                [ ol [ id "file-list" ] (List.map fileItem filtered)
                , div [ class "total-size-wrapper" ]
                    [ text "+ "
                    , span [ id "total-size", title ("Total size: " ++ formatByteSize totalSize ++ " bytes") ]
                        [ text (formatByteSizeSuffix totalSize) ]
                    ]
                ]
            ]
        , div [ id "right-panel" ]
            [ div [ id "source-toolbar" ]
                [ case model.selectedFile of
                    Just path ->
                        div [ class "file-specific-toolbar" ]
                            [ button [ onClick ToggleBeautify ]
                                [ text
                                    (if model.isBeautified then
                                        "Show original code"

                                     else
                                        "Show beautified code"
                                    )
                                ]
                            , button [ onClick ToggleAnalysis ]
                                [ text
                                    (if model.showAnalysis then
                                        "Hide analysis"

                                     else
                                        "Show analysis"
                                    )
                                ]
                            ]

                    Nothing ->
                        text ""
                ]
            , div [ id "source-code" ]
                [ if model.isLoading && not (List.isEmpty model.files) then
                    div [ id "initial-status" ] [ text "Loading..." ]

                  else
                    case model.selectedFileHtml of
                        Just html ->
                            node "pre" [ class "linenums auto-wordwrap", property "innerHTML" (E.string html) ] []

                        Nothing ->
                            div [ id "initial-status" ] [ text (Maybe.withDefault "Select a file to inspect" model.errorMessage) ]
                ]
            ]
        ]


type alias ZipMetadata =
    { entries : List ZipEntry
    , zipname : String
    , downloadUrl : Maybe String
    , crxDownloadUrl : Maybe String
    , crxDownloadName : Maybe String
    , webstoreUrl : Maybe String
    , openViewerUrl : Maybe String
    }


metadataDecoder : D.Decoder ZipMetadata
metadataDecoder =
    D.map7 ZipMetadata
        (D.field "entries" (D.list zipEntryDecoder))
        (D.field "zipname" D.string)
        (D.maybe (D.field "downloadUrl" D.string))
        (D.maybe (D.field "crxDownloadUrl" D.string))
        (D.maybe (D.field "crxDownloadName" D.string))
        (D.maybe (D.field "webstoreUrl" D.string))
        (D.maybe (D.field "openViewerUrl" D.string))


zipEntryDecoder : D.Decoder ZipEntry
zipEntryDecoder =
    D.map3 ZipEntry
        (D.field "path" D.string)
        (D.field "size" D.int)
        (D.field "isDirectory" D.bool)


main : Program D.Value Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = subscriptions
        , view = view
        }
