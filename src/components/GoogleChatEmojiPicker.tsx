import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Smile, Heart, User, Utensils, Award, Lightbulb } from 'lucide-react';

interface GoogleChatEmojiPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
}

interface EmojiCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  emojis: { char: string; name: string }[];
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    name: 'Smileys & Emotion',
    icon: <Smile className="w-4 h-4" />,
    emojis: [
      { char: '😀', name: 'grinning face smile' },
      { char: '😃', name: 'grinning face with big eyes' },
      { char: '😄', name: 'grinning face with smiling eyes' },
      { char: '😁', name: 'beaming face with smiling eyes' },
      { char: '😆', name: 'grinning squinting face laugh' },
      { char: '😅', name: 'grinning face with sweat phew' },
      { char: '😂', name: 'face with tears of joy lol haha' },
      { char: '🤣', name: 'rolling on the floor laughing rofl' },
      { char: '🥲', name: 'smiling face with tear bitter happy' },
      { char: '☺️', name: 'smiling face classic' },
      { char: '😊', name: 'smiling face with smiling eyes warm' },
      { char: '😇', name: 'smiling face with halo angel innocent' },
      { char: '🙂', name: 'slightly smiling face fine' },
      { char: '🙃', name: 'upside down face sarcasm silliness' },
      { char: '😉', name: 'winking face playful flirt' },
      { char: '😌', name: 'relieved face calm serene' },
      { char: '😍', name: 'smiling face with heart eyes love' },
      { char: '🥰', name: 'smiling face with hearts affection cute' },
      { char: '😘', name: 'face blowing a kiss love romantic' },
      { char: '😋', name: 'face savoring food delicious yum' },
      { char: '😛', name: 'face with tongue playful' },
      { char: '😜', name: 'winking face with tongue crazy' },
      { char: '🤪', name: 'zany face goofy wild' },
      { char: '😝', name: 'squinting face with tongue excited' },
      { char: '🤑', name: 'money-mouth face rich cash' },
      { char: '🤗', name: 'smiling face with open hands hug' },
      { char: '🤭', name: 'face with hand over mouth oops teehee' },
      { char: '🤫', name: 'shushing face quiet secret hush' },
      { char: '🤔', name: 'thinking face hmm wonder consider' },
      { char: '🤐', name: 'zipper-mouth face silent secrets' },
      { char: '🤨', name: 'face with raised eyebrow skeptical' },
      { char: '😐', name: 'neutral face straight deadpan' },
      { char: '😑', name: 'expressionless face whatever' },
      { char: '😶', name: 'face without mouth speechless' },
      { char: '😏', name: 'smirking face sly smug' },
      { char: '😒', name: 'unamused face annoyed bored' },
      { char: '🙄', name: 'face with rolling eyes eye roll duh' },
      { char: '😬', name: 'grimacing face awkward yikes' },
      { char: '🤥', name: 'lying face pinocchio long nose' },
      { char: '😌', name: 'relieved face content' },
      { char: '😔', name: 'pensive face sad dejected' },
      { char: '😪', name: 'sleepy face snot drip tired' },
      { char: '🤤', name: 'drooling face hungry asleep' },
      { char: '😴', name: 'sleeping face zzz goodnight' },
      { char: '😷', name: 'face with medical mask sick hygiene' },
      { char: '🤒', name: 'face with thermometer illness fever' },
      { char: '🤕', name: 'face with head-bandage injured hurt' },
      { char: '🤢', name: 'nauseated face gross vomit green' },
      { char: '🤮', name: 'face vomiting throwing up disgust' },
      { char: '🤧', name: 'sneezing face cold bless you' },
      { char: '🥵', name: 'hot face sweating summer heat' },
      { char: '🥶', name: 'cold face freezing winter ice' },
      { char: '🥴', name: 'woozy face dizzy tipsy intoxicated' },
      { char: '😵', name: 'face with crossed-out eyes knockout' },
      { char: '🤯', name: 'exploding head mind blown shocked' },
      { char: '🤠', name: 'cowboy hat face howdy' },
      { char: '🥳', name: 'partying face celebrate horn confetti' },
      { char: '🥸', name: 'disguised face mustache glasses spy' },
      { char: '😎', name: 'smiling face with sunglasses cool boss' },
      { char: '🤓', name: 'nerd face geek smart' },
      { char: '🧐', name: 'face with monocle sophisticated curious' },
      { char: '😕', name: 'confused face puzzled' },
      { char: '😟', name: 'worried face anxious' },
      { char: '🙁', name: 'slightly frowning face unhappy' },
      { char: '😮', name: 'face with open mouth surprised' },
      { char: '😯', name: 'hushed face startled' },
      { char: '😲', name: 'astonished face gasp amazed' },
      { char: '😳', name: 'flushed face embarrassed blushing' },
      { char: '🥺', name: 'pleading face puppy eyes please beg' },
      { char: '😦', name: 'frowning face with open mouth fear' },
      { char: '😧', name: 'anguished face agony' },
      { char: '😨', name: 'fearful face scared' },
      { char: '😰', name: 'anxious face with sweat nervous' },
      { char: '😥', name: 'sad but relieved face whew' },
      { char: '😢', name: 'crying face tear sadness' },
      { char: '😭', name: 'loudly crying face sob weeping' },
      { char: '😱', name: 'face screaming in fear horrified scream' },
      { char: '😖', name: 'confounded face distressed' },
      { char: '😣', name: 'persevering face struggling' },
      { char: '😞', name: 'disappointed face regret' },
      { char: '😓', name: 'downcast face with sweat stress' },
      { char: '😩', name: 'weary face exhausted tired' },
      { char: '😫', name: 'tired face frustrated' },
      { char: '🥱', name: 'yawning face sleepy bored' },
      { char: '😤', name: 'face with steam from nose proud angry triumph' },
      { char: '😡', name: 'enraged face mad red angry furious' },
      { char: '😠', name: 'angry face irritated cross' },
      { char: '🤬', name: 'face with symbols on mouth cussing swear' },
      { char: '😈', name: 'smiling face with horns devil mischief' },
      { char: '👿', name: 'angry face with horns evil devil imp' },
      { char: '💀', name: 'skull dead dying laughing' },
      { char: '💩', name: 'pile of poo poop turd funny' },
      { char: '🤡', name: 'clown face circus foolish' },
      { char: '👻', name: 'ghost boo spooky halloween' },
      { char: '👽', name: 'alien extraterrestrial ufo' },
      { char: '🤖', name: 'robot face tech automated bot' },
      { char: '🐵', name: 'monkey face cute animal primate' },
      { char: '🙈', name: 'see-no-evil monkey shy hide' },
      { char: '🙉', name: 'hear-no-evil monkey' },
      { char: '🙊', name: 'speak-no-evil monkey quiet' },
    ],
  },
  {
    id: 'people',
    name: 'People & Gestures',
    icon: <User className="w-4 h-4" />,
    emojis: [
      { char: '👋', name: 'waving hand wave hello goodbye hi' },
      { char: '🤚', name: 'raised back of hand stop' },
      { char: '🖐️', name: 'hand with fingers splayed palm' },
      { char: '✋', name: 'raised hand high five halt' },
      { char: '🖖', name: 'vulcan salute spock live long prosper' },
      { char: '👌', name: 'ok hand perfect nice alright' },
      { char: '🤌', name: 'pinched fingers italian mama mia' },
      { char: '🤏', name: 'pinching hand small tiny little bit' },
      { char: '✌️', name: 'victory hand peace v sign two' },
      { char: '🤞', name: 'crossed fingers luck hopeful' },
      { char: '🤟', name: 'love-you gesture sign language ily' },
      { char: '🤘', name: 'sign of the horns rock on metal' },
      { char: '🤙', name: 'call me hand shaka hang loose' },
      { char: '👈', name: 'backhand index pointing left point' },
      { char: '👉', name: 'backhand index pointing right point' },
      { char: '👆', name: 'backhand index pointing up point' },
      { char: '👇', name: 'backhand index pointing down point' },
      { char: '☝️', name: 'index pointing up attention note' },
      { char: '👍', name: 'thumbs up approve agree good like yes' },
      { char: '👎', name: 'thumbs down disapprove bad dislike no' },
      { char: '✊', name: 'raised fist solidarity power punch' },
      { char: '👊', name: 'oncoming fist bump brofist' },
      { char: '🤛', name: 'left-facing fist bump' },
      { char: '🤜', name: 'right-facing fist bump' },
      { char: '👏', name: 'clapping hands applause bravo congrats' },
      { char: '🙌', name: 'raising hands celebration hooray praise' },
      { char: '👐', name: 'open hands openness hug' },
      { char: '🤲', name: 'palms up together prayer offering' },
      { char: '🤝', name: 'handshake deal agree partner greeting' },
      { char: '🙏', name: 'folded hands please thank you pray namaste' },
      { char: '✍️', name: 'writing hand note author text' },
      { char: '💅', name: 'nail polish care sassy confidence' },
      { char: '🤳', name: 'selfie camera photo phone' },
      { char: '💪', name: 'flexed biceps strong muscle workout strength' },
      { char: '👀', name: 'eyes look see glance attention watching' },
      { char: '👁️', name: 'eye vision see look' },
      { char: '🗣️', name: 'speaking head speak talk shout announcement' },
      { char: '👤', name: 'bust in silhouette user person account' },
      { char: '👥', name: 'busts in silhouette people group team' },
    ],
  },
  {
    id: 'hearts',
    name: 'Hearts & Reactions',
    icon: <Heart className="w-4 h-4" />,
    emojis: [
      { char: '❤️', name: 'red heart love passion romance classic' },
      { char: '🧡', name: 'orange heart warm care friendly' },
      { char: '💛', name: 'yellow heart friendship happiness gold' },
      { char: '💚', name: 'green heart nature health jealousy' },
      { char: '💙', name: 'blue heart trust peace loyalty cool' },
      { char: '💜', name: 'purple heart royalty magic luxury' },
      { char: '🖤', name: 'black heart dark goth sadness chic' },
      { char: '🤍', name: 'white heart pure angel peace' },
      { char: '🤎', name: 'brown heart warmth cocoa earth' },
      { char: '💔', name: 'broken heart heartbreak sad breakup pain' },
      { char: '❣️', name: 'heart exclamation emphasis devotion' },
      { char: '💕', name: 'two hearts affection sweet cute' },
      { char: '💞', name: 'revolving hearts love in air swirl' },
      { char: '💓', name: 'beating heart pulse alive love' },
      { char: '💗', name: 'growing heart expanding excitement' },
      { char: '💖', name: 'sparkling heart shine sparkle magical' },
      { char: '💘', name: 'heart with arrow cupid struck romance' },
      { char: '💝', name: 'heart with ribbon gift present love' },
      { char: '🔥', name: 'fire flame lit hot trend viral burning' },
      { char: '✨', name: 'sparkles clean magic stars shiny fresh' },
      { char: '🌟', name: 'glowing star bright shining special' },
      { char: '⭐', name: 'star favorite rating bookmark' },
      { char: '💥', name: 'collision boom impact explosion bang' },
      { char: '💯', name: 'hundred points 100 perfect full true' },
      { char: '💢', name: 'anger symbol mad anime comic vein' },
      { char: '💦', name: 'sweat droplets water splash exertion' },
      { char: '💨', name: 'dashing away fast run speed wind puff' },
      { char: '💫', name: 'dizzy star swirl cosmos magic' },
      { char: '💬', name: 'speech balloon chat talk message quote' },
      { char: '💭', name: 'thought balloon think daydream wonder' },
      { char: '💤', name: 'zzz sleeping tired dream nap' },
    ],
  },
  {
    id: 'activities',
    name: 'Celebration & Activities',
    icon: <Award className="w-4 h-4" />,
    emojis: [
      { char: '🎉', name: 'party popper celebrate tada congratulations yay' },
      { char: '🎊', name: 'confetti ball festival party fiesta' },
      { char: '🎈', name: 'balloon birthday celebration party' },
      { char: '🎂', name: 'birthday cake dessert celebration anniversary' },
      { char: '🎁', name: 'wrapped gift present surprise box' },
      { char: '🎀', name: 'ribbon bow decoration cute' },
      { char: '🏆', name: 'trophy champion winner award first place' },
      { char: '🥇', name: '1st place medal gold winner' },
      { char: '🥈', name: '2nd place medal silver runner up' },
      { char: '🥉', name: '3rd place medal bronze' },
      { char: '⚽', name: 'soccer ball football sports kick' },
      { char: '🏀', name: 'basketball sports hoop dunk' },
      { char: '🏈', name: 'american football sports nfl' },
      { char: '⚾', name: 'baseball sports strike home run' },
      { char: '🎾', name: 'tennis ball sports racket match' },
      { char: '🏐', name: 'volleyball beach sports' },
      { char: '🎱', name: 'pool 8 ball billiards game luck' },
      { char: '🏓', name: 'ping pong table tennis sports paddle' },
      { char: '🏸', name: 'badminton shuttlecock racket sports' },
      { char: '🎯', name: 'bullseye direct hit target goal accuracy' },
      { char: '🎮', name: 'video game controller gaming play gamer' },
      { char: '🎲', name: 'game die dice gamble chance random' },
      { char: '🎨', name: 'artist palette art paint creative color' },
      { char: '🎬', name: 'clapper board cinema movie film action' },
      { char: '🎤', name: 'microphone singing music karaoke host' },
      { char: '🎧', name: 'headphone audio music sound podcast' },
      { char: '🎼', name: 'musical score notes sheet song melody' },
      { char: '🎵', name: 'musical note sound tune tune song' },
      { char: '🎶', name: 'musical notes harmony rhythm audio' },
    ],
  },
  {
    id: 'food',
    name: 'Food & Drink',
    icon: <Utensils className="w-4 h-4" />,
    emojis: [
      { char: '☕', name: 'hot beverage coffee tea morning cafe cup' },
      { char: '🍵', name: 'teacup without handle green tea matcha' },
      { char: '🧃', name: 'beverage box juice straw box drink' },
      { char: '🥤', name: 'cup with straw soda drink cold beverage' },
      { char: '🧋', name: 'bubble tea boba milk tea tapioca' },
      { char: '🍶', name: 'sake japanese liquor drink bottle cup' },
      { char: '🍺', name: 'beer mug alcohol cheers pub drink' },
      { char: '🍻', name: 'clinking beer mugs toast cheers celebration' },
      { char: '🥂', name: 'clinking glasses champagne toast luxury' },
      { char: '🍷', name: 'wine glass red alcoholic drink dinner' },
      { char: '🍸', name: 'cocktail glass martini olive party' },
      { char: '🍹', name: 'tropical drink cocktail beach vacation' },
      { char: '🍕', name: 'pizza slice cheese pepperoni fast food' },
      { char: '🍔', name: 'hamburger burger fast food diner' },
      { char: '🍟', name: 'french fries chips fast food snack' },
      { char: '🌭', name: 'hot dog frankfurter sausage snack' },
      { char: '🍿', name: 'popcorn movie cinema snack theater' },
      { char: '🥓', name: 'bacon meat breakfast savory' },
      { char: '🍳', name: 'cooking egg breakfast skillet frying pan' },
      { char: '🧇', name: 'waffle breakfast syrup sweet' },
      { char: '🥞', name: 'pancakes breakfast stack maple butter' },
      { char: '🍞', name: 'bread loaf toast bakery wheat' },
      { char: '🥐', name: 'croissant bakery pastry french breakfast' },
      { char: '🥖', name: 'baguette bread french bakery loaf' },
      { char: '🥨', name: 'pretzel salted bakery snack twist' },
      { char: '🥯', name: 'bagel bakery breakfast spread' },
      { char: '🧀', name: 'cheese wedge swiss dairy yellow' },
      { char: '🥗', name: 'green salad healthy diet vegetables' },
      { char: '🥪', name: 'sandwich lunch deli meal bread' },
      { char: '🌮', name: 'taco mexican food wrap tortilla' },
      { char: '🌯', name: 'burrito mexican food wrap meal' },
      { char: '🍱', name: 'bento box japanese lunch meal compartmental' },
      { char: '🍙', name: 'rice ball onigiri japanese seaweed snack' },
      { char: '🍚', name: 'cooked rice bowl staple asian food' },
      { char: '🍛', name: 'curry rice spicy dinner meal indian japanese' },
      { char: '🍜', name: 'steaming bowl ramen noodles soup chopsticks' },
      { char: '🍝', name: 'spaghetti pasta italian dinner noodle' },
      { char: '🍣', name: 'sushi japanese salmon tuna raw fish' },
      { char: '🍤', name: 'fried shrimp tempura japanese seafood' },
      { char: '🍡', name: 'dango sweet rice dumpling skewers japanese' },
      { char: '🥟', name: 'dumpling gyoza potsticker dim sum' },
      { char: '🍦', name: 'soft ice cream vanilla dessert swirl cone' },
      { char: '🍧', name: 'shaved ice dessert syrup summer kakigori' },
      { char: '🍨', name: 'ice cream dessert bowl spoon sweet' },
      { char: '🍩', name: 'doughnut sweet pastry dessert glazed' },
      { char: '🍪', name: 'cookie chocolate chip baked dessert sweet' },
      { char: '🍰', name: 'shortcake cake slice dessert strawberry' },
      { char: '🧁', name: 'cupcake muffin frosting dessert' },
      { char: '🍫', name: 'chocolate bar sweet candy cocoa snack' },
      { char: '🍬', name: 'candy sweet wrapper confectionery sugar' },
      { char: '🍭', name: 'lollipop candy sweet spiral sucker' },
    ],
  },
  {
    id: 'objects',
    name: 'Objects & Symbols',
    icon: <Lightbulb className="w-4 h-4" />,
    emojis: [
      { char: '💡', name: 'light bulb idea inspiration brainstorm tip' },
      { char: '🔦', name: 'flashlight search dark beam electric' },
      { char: '🕯️', name: 'candle flame light wax wax' },
      { char: '📦', name: 'package parcel box delivery cardboard' },
      { char: '✉️', name: 'envelope mail letter email message' },
      { char: '📧', name: 'e-mail electronic mail message inbox' },
      { char: '📬', name: 'open mailbox with raised flag received' },
      { char: '📝', name: 'memo pencil document note write report' },
      { char: '📁', name: 'file folder storage directory archive' },
      { char: '📅', name: 'calendar date schedule event month' },
      { char: '📆', name: 'tear-off calendar date daily today' },
      { char: '📈', name: 'chart increasing growth graph upward success' },
      { char: '📉', name: 'chart decreasing loss graph downward drop' },
      { char: '📊', name: 'bar chart analytics report stats compare' },
      { char: '📌', name: 'pushpin pin map marker save remember' },
      { char: '📍', name: 'round pushpin location map pin place' },
      { char: '📎', name: 'paperclip attach clip office binder' },
      { char: '🔒', name: 'locked padlock security safe protect private' },
      { char: '🔓', name: 'unlocked padlock access open security' },
      { char: '🔑', name: 'key password access secret unlock login' },
      { char: '🗝️', name: 'old key antique vintage secret' },
      { char: '🔔', name: 'bell notification alert alarm reminder ring' },
      { char: '🔕', name: 'bell with slash silent mute quiet' },
      { char: '📣', name: 'megaphone cheering announce shout speak' },
      { char: '📢', name: 'loudspeaker broadcast sound volume alert' },
      { char: '⚠️', name: 'warning sign caution danger alert care' },
      { char: '❓', name: 'red question mark query help ask what' },
      { char: '❗', name: 'red exclamation mark alert important note' },
      { char: '💻', name: 'laptop computer tech pc work keyboard' },
      { char: '📱', name: 'mobile phone smartphone cell call screen' },
      { char: '⏰', name: 'alarm clock time wake bell morning' },
      { char: '⏳', name: 'hourglass not done time loading wait pending' },
      { char: '🚀', name: 'rocket ship blast off launch fast space moon' },
      { char: '🛸', name: 'flying saucer ufo alien space extraterrestrial' },
      { char: '🚗', name: 'automobile car vehicle drive travel' },
      { char: '🏎️', name: 'racing car speed race formula fast' },
      { char: '✈️', name: 'airplane travel flight vacation sky' },
    ],
  },
];

export const GoogleChatEmojiPicker: React.FC<GoogleChatEmojiPickerProps> = ({
  onSelectEmoji,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<string>('smileys');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Handle clicking outside to dismiss
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Filter emojis based on search query
  const filteredEmojis = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;

    const matched: { char: string; name: string }[] = [];
    const seen = new Set<string>();

    for (const category of EMOJI_CATEGORIES) {
      for (const emoji of category.emojis) {
        if (emoji.name.toLowerCase().includes(q) && !seen.has(emoji.char)) {
          seen.add(emoji.char);
          matched.push(emoji);
        }
      }
    }
    return matched;
  }, [searchQuery]);

  const activeCategory = useMemo(() => {
    return (
      EMOJI_CATEGORIES.find((c) => c.id === activeTab) || EMOJI_CATEGORIES[0]
    );
  }, [activeTab]);

  return (
    <div
      ref={pickerRef}
      role="dialog"
      aria-label="Google Chat Emoji Picker"
      className="absolute bottom-full right-0 mb-3 w-80 sm:w-96 bg-[#2c2e31] border border-[#444444] rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden font-sans text-[#d1d0c5] animate-in fade-in zoom-in-95 duration-100"
      style={{ maxHeight: '380px' }}
    >
      {/* Header & Search Bar (Google Chat Style) */}
      <div className="p-2.5 border-b border-[#444444] bg-[#26282b] flex items-center gap-2">
        <div className="relative flex-1 flex items-center">
          <Search className="w-4 h-4 text-[#777777] absolute left-2.5 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search emoji..."
            className="w-full bg-[#323437] border border-[#444444] rounded-lg pl-8 pr-7 py-1.5 text-xs text-[#d1d0c5] placeholder-[#777777] focus:outline-none focus:border-[#e2b714] transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 text-[#777777] hover:text-[#d1d0c5] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-[#777777] hover:text-[#d1d0c5] hover:bg-[#323437] rounded-md transition-colors cursor-pointer"
          title="Close emoji picker"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Category Tabs (if not searching) */}
      {!searchQuery && (
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#444444] bg-[#26282b] text-[#888888]">
          {EMOJI_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveTab(cat.id)}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer flex items-center justify-center ${
                activeTab === cat.id
                  ? 'bg-[#323437] text-[#e2b714]'
                  : 'hover:bg-[#323437] hover:text-[#d1d0c5]'
              }`}
              title={cat.name}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      {/* Emoji Grid Stream */}
      <div className="flex-1 overflow-y-auto p-3 max-h-56 scrollbar-thin scrollbar-thumb-[#444444]">
        {searchQuery ? (
          <div>
            <div className="text-[11px] font-medium text-[#777777] mb-2 px-1">
              {filteredEmojis && filteredEmojis.length > 0
                ? `Results for "${searchQuery}" (${filteredEmojis.length})`
                : `No emojis matching "${searchQuery}"`}
            </div>
            {filteredEmojis && filteredEmojis.length > 0 ? (
              <div className="grid grid-cols-7 sm:grid-cols-8 gap-1">
                {filteredEmojis.map((emoji, idx) => (
                  <button
                    key={`${emoji.char}_${idx}`}
                    type="button"
                    onClick={() => {
                      onSelectEmoji(emoji.char);
                    }}
                    title={emoji.name}
                    className="w-9 h-9 flex items-center justify-center text-xl hover:bg-[#323437] rounded-lg transition-transform hover:scale-125 cursor-pointer active:scale-95"
                  >
                    {emoji.char}
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-[#666666]">
                Try searching for "smile", "love", "fire", "thumb", or "cat"
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-[11px] font-semibold text-[#888888] mb-2 px-1 tracking-wider uppercase">
              {activeCategory.name}
            </div>
            <div className="grid grid-cols-7 sm:grid-cols-8 gap-1">
              {activeCategory.emojis.map((emoji, idx) => (
                <button
                  key={`${emoji.char}_${idx}`}
                  type="button"
                  onClick={() => {
                    onSelectEmoji(emoji.char);
                  }}
                  title={emoji.name}
                  className="w-9 h-9 flex items-center justify-center text-xl hover:bg-[#323437] rounded-lg transition-transform hover:scale-125 cursor-pointer active:scale-95"
                >
                  {emoji.char}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Google Chat Footer Cue */}
      <div className="px-3 py-1.5 bg-[#26282b] border-t border-[#444444] flex items-center justify-between text-[10px] text-[#888888]">
        <span>Google Chat Default Emojis</span>
        <span>Click to insert</span>
      </div>
    </div>
  );
};
