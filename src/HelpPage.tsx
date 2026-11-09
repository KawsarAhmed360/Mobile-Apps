import { useState } from 'react';
import { PlaySquare } from 'lucide-react';
import './tutorial.css';

const tutorialVideo = new URL('./tutorial-assets/smartshop-tour.mp4', import.meta.url).href;
const tutorialPoster = new URL('./tutorial-assets/smartshop-tour-poster.jpg', import.meta.url).href;

export function HelpPage() {
  const [videoError, setVideoError] = useState(false);

  return <section className="panel tutorial-panel" aria-labelledby="tutorial-title">
    <div className="tutorial-heading">
      <span className="tutorial-icon"><PlaySquare size={22} aria-hidden="true" /></span>
      <div>
        <h2 id="tutorial-title">SmartShop quick tour</h2>
        <p lang="bn">বাংলা কণ্ঠে পণ্য খোঁজা, স্টক দেখা, নতুন বিক্রি ও রিপোর্ট তৈরির টিউটোরিয়াল।</p>
      </div>
    </div>
    <video className="tutorial-video" aria-labelledby="tutorial-title" src={tutorialVideo} poster={tutorialPoster}
      controls playsInline preload="metadata" onError={() => setVideoError(true)} onLoadedMetadata={() => setVideoError(false)}>
      <p><a href={tutorialVideo}>Open the SmartShop tutorial video</a></p>
    </video>
    {videoError && <p className="tutorial-error" role="alert">The player could not load the tutorial. <a href={tutorialVideo}>Open the video file</a></p>}
    <details className="tutorial-steps" lang="bn">
      <summary>ভিডিওর ধাপগুলো পড়ো</summary>
      <ol>
        <li><span lang="en">Products</span> থেকে নাম বা ক্যাটাগরি দিয়ে পণ্য খুঁজে দাম ও স্টক দেখো।</li>
        <li>দোকানের অ্যাকাউন্টে <span lang="en">Products &amp; stock</span> খুলে পণ্য ও স্টকের হিসাব দেখো।</li>
        <li><span lang="en">New sale</span>-এ পণ্য বেছে পরিমাণ ও পেমেন্ট দিয়ে বিক্রি সেভ করো।</li>
        <li><span lang="en">Reports &amp; PDFs</span>-এ রিপোর্টের ধরন ও তারিখ বেছে PDF নাও।</li>
      </ol>
    </details>
  </section>;
}
